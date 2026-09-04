import type { CompositeDef, Design, Instance, PinRef, PrimitiveDef } from '@gatefold/model'
import {
  findConnectionTo,
  inputPorts,
  outputPorts,
  parseDesign,
  pinKey,
  pinWidth,
  primitiveOf,
  sanitizeDesign,
  UnionFind,
  withBuiltinPrimitives,
} from '@gatefold/model'

/**
 * Verilog codegen. Input is the serialized design JSON (`serializeDesign` output); output
 * is a synthesizable Verilog module hierarchy. Kept fully separate from the app: it only
 * depends on `@gatefold/model` (to parse the JSON and resolve bus widths).
 */

export interface VerilogIssue {
  level: 'info' | 'error'
  message: string
}

export interface VerilogResult {
  source: string
  issues: VerilogIssue[]
}

/** Verilog-2001 reserved words (a superset of what we might collide with). */
const KEYWORDS = new Set([
  'always', 'and', 'assign', 'begin', 'buf', 'case', 'default', 'else', 'end', 'endcase',
  'endmodule', 'endfunction', 'endtask', 'for', 'function', 'generate', 'genvar', 'if',
  'initial', 'inout', 'input', 'integer', 'localparam', 'module', 'negedge', 'nand', 'nor',
  'not', 'or', 'output', 'parameter', 'posedge', 'real', 'reg', 'repeat', 'signed', 'task',
  'tri', 'unsigned', 'while', 'wire', 'wand', 'wor', 'xnor', 'xor',
])

/** Turn a user-supplied name into a legal Verilog identifier: replace illegal characters,
 *  fall back to `net` when empty, prefix a leading digit, and append `_` to reserved words. */
function sanitizeIdentifier(raw: string): string {
  let s = raw.replace(/[^A-Za-z0-9_$]/g, '_')
  if (!s) s = 'net'
  if (/^[0-9]/.test(s)) s = '_' + s
  if (KEYWORDS.has(s)) s = s + '_'
  return s
}

/** Sanitize `base`, then dedup against `used` by appending `_2`, `_3`, … */
function uniqueName(base: string, used: Set<string>): string {
  const b = sanitizeIdentifier(base)
  let name = b
  let i = 2
  while (used.has(name)) name = `${b}_${i++}`
  used.add(name)
  return name
}

interface ModPort {
  dir: 'input' | 'output'
  name: string
  width: number
}

class Generator {
  private readonly design: Design
  private readonly issues: VerilogIssue[]
  private readonly moduleNames = new Set<string>()
  private readonly defToModule = new Map<string, string>()
  private readonly portNames = new Map<string, Map<string, string>>()

  constructor(design: Design, issues: VerilogIssue[]) {
    this.design = design
    this.issues = issues
  }

  private info(message: string): void {
    this.issues.push({ level: 'info', message })
  }

  private error(message: string): void {
    this.issues.push({ level: 'error', message })
  }

  generate(): string {
    const root = this.design.defs[this.design.root]
    if (!root || root.kind !== 'composite') {
      throw new Error('Design root is not a composite')
    }
    const order = this.collectComposites(root.id)
    for (const id of order) {
      const def = this.design.defs[id]
      this.defToModule.set(id, uniqueName(def.name || def.id, this.moduleNames))
      this.computePortNames(id)
    }
    const parts: string[] = []
    for (const id of order) {
      const def = this.design.defs[id]
      if (!def || def.kind !== 'composite') continue
      parts.push(this.emitModule(def, id === this.design.root))
    }
    return parts.join('\n\n') + '\n'
  }

  /** Composite def ids reachable from `rootId`, children before parents. */
  private collectComposites(rootId: string): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const visit = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const def = this.design.defs[id]
      if (!def || def.kind !== 'composite') return
      for (const inst of def.instances ?? []) {
        const idef = this.design.defs[inst.defId]
        if (idef && idef.kind === 'composite') visit(inst.defId)
      }
      out.push(id)
    }
    visit(rootId)
    return out
  }

  /** The deduped Verilog port names for a composite's own input/output terminals. */
  private computePortNames(defId: string): Map<string, string> {
    const cached = this.portNames.get(defId)
    if (cached) return cached
    const def = this.design.defs[defId]
    const used = new Set<string>()
    const map = new Map<string, string>()
    for (const p of [...inputPorts(def), ...outputPorts(def)]) {
      map.set(p.id, uniqueName(p.name || p.id, used))
    }
    this.portNames.set(defId, map)
    return map
  }

  private emitModule(def: CompositeDef, isRoot: boolean): string {
    const design = this.design
    const instances = def.instances ?? []
    const connections = def.connections ?? []
    const byId = new Map(instances.map((i) => [i.id, i]))

    const isPortGroupInst = (inst: Instance, dir: 'input' | 'output'): boolean => {
      const idef = design.defs[inst.defId]
      return !!idef && idef.kind === 'primitive' && idef.primitive === (dir === 'input' ? 'input-port' : 'output-port')
    }
    const inputGroup = instances.find((i) => isPortGroupInst(i, 'input'))
    const outputGroup = instances.find((i) => isPortGroupInst(i, 'output'))

    const portNameMap = this.computePortNames(def.id)

    // Sources/sinks are only exported at the top level (they become I/O pins). A nested
    // switch is emitted as a fixed constant (see the statement loop).
    const sources: Instance[] = []
    const sinks: Instance[] = []
    for (const inst of instances) {
      const idef = design.defs[inst.defId]
      if (!idef || idef.kind !== 'primitive') continue
      if (idef.primitive === 'clock') {
        if (isRoot) sources.push(inst)
        else this.error(`clock source "${inst.name}" nested in composite "${def.name}" is not exported`)
      } else if (idef.primitive === 'switch-array') {
        if (isRoot) sources.push(inst)
        else this.info(`switch "${inst.name}" nested in composite "${def.name}" is exported as a fixed initial value`)
      } else if (idef.primitive === 'led-array' || idef.primitive === 'seven-seg') {
        if (isRoot) sinks.push(inst)
        else this.info(`sink "${inst.name}" nested in composite "${def.name}" is not exported`)
      }
    }

    // Module ports (composite terminals first, then source/sink I/O). Composite port names
    // come from `portNameMap` (already deduped among themselves); the extra source/sink ports
    // and internal nets are deduped against them.
    const used = new Set<string>(portNameMap.values())
    const ports: ModPort[] = []
    const addExtraPort = (dir: ModPort['dir'], base: string, width: number): string => {
      const name = uniqueName(base, used)
      ports.push({ dir, name, width })
      return name
    }

    const inputPortNames = new Map<string, string>()
    const inputPortWidths = new Map<string, number>()
    for (const p of inputPorts(def)) {
      const w = inputGroup ? pinWidth(design, def, { instanceId: inputGroup.id, portId: p.id }) : 1
      const name = portNameMap.get(p.id)!
      ports.push({ dir: 'input', name, width: w })
      inputPortNames.set(p.id, name)
      inputPortWidths.set(p.id, w)
    }
    const outputPortNames = new Map<string, string>()
    const outputPortWidths = new Map<string, number>()
    for (const p of outputPorts(def)) {
      const w = outputGroup ? pinWidth(design, def, { instanceId: outputGroup.id, portId: p.id }) : 1
      const name = portNameMap.get(p.id)!
      ports.push({ dir: 'output', name, width: w })
      outputPortNames.set(p.id, name)
      outputPortWidths.set(p.id, w)
    }
    const sourcePorts = new Map<string, { name: string; width: number }>()
    for (const inst of sources) {
      const idef = design.defs[inst.defId]
      for (const p of outputPorts(idef)) {
        const w = pinWidth(design, def, { instanceId: inst.id, portId: p.id })
        sourcePorts.set(pinKey({ instanceId: inst.id, portId: p.id }), { name: addExtraPort('input', `${inst.name}_${p.name}`, w), width: w })
      }
    }
    const sinkPorts = new Map<string, { name: string; width: number }>()
    for (const inst of sinks) {
      const idef = design.defs[inst.defId]
      for (const p of inputPorts(idef)) {
        const w = pinWidth(design, def, { instanceId: inst.id, portId: p.id })
        sinkPorts.set(pinKey({ instanceId: inst.id, portId: p.id }), { name: addExtraPort('output', `${inst.name}_${p.name}`, w), width: w })
      }
    }

    // Resolve nets with a union-find over connection endpoints.
    const uf = new UnionFind()
    for (const c of connections) uf.union(pinKey(c.from), pinKey(c.to))

    const allPins: PinRef[] = []
    if (inputGroup) for (const p of inputPorts(def)) allPins.push({ instanceId: inputGroup.id, portId: p.id })
    if (outputGroup) for (const p of outputPorts(def)) allPins.push({ instanceId: outputGroup.id, portId: p.id })
    for (const inst of instances) {
      if (inst.id === inputGroup?.id || inst.id === outputGroup?.id) continue
      const idef = design.defs[inst.defId]
      if (!idef) continue
      for (const p of idef.ports) allPins.push({ instanceId: inst.id, portId: p.id })
    }

    const rootMembers = new Map<string, PinRef[]>()
    for (const pin of allPins) {
      const r = uf.find(pinKey(pin))
      const arr = rootMembers.get(r) ?? []
      arr.push(pin)
      rootMembers.set(r, arr)
    }

    const netNameOfPin = new Map<string, string>()
    const netWidthByName = new Map<string, number>()
    // Module output(s) sharing a net that is also a module input (or otherwise named
    // differently) need a bridging `assign <output> = <net>;` — e.g. a switch wired
    // straight to an LED, or a gate output fanning out to two sinks.
    const bridges: string[] = []
    for (const members of rootMembers.values()) {
      // Input-side port (drives the net): a composite input port or a source pin.
      let name: string | null = null
      let width = 1
      for (const m of members) {
        if (inputGroup && m.instanceId === inputGroup.id) { name = inputPortNames.get(m.portId)!; width = inputPortWidths.get(m.portId)!; break }
      }
      if (name === null) for (const m of members) { const s = sourcePorts.get(pinKey(m)); if (s) { name = s.name; width = s.width; break } }

      // Output-side port(s) (read the net): a composite output port or a sink pin.
      const outputs: { name: string; width: number }[] = []
      for (const m of members) {
        if (outputGroup && m.instanceId === outputGroup.id) {
          outputs.push({ name: outputPortNames.get(m.portId)!, width: outputPortWidths.get(m.portId)! })
        }
      }
      for (const m of members) { const s = sinkPorts.get(pinKey(m)); if (s) outputs.push({ name: s.name, width: s.width }) }

      if (name === null && outputs.length > 0) { name = outputs[0].name; width = outputs[0].width }

      if (name === null) {
        for (const m of members) {
          const inst = byId.get(m.instanceId)
          const idef = inst && design.defs[inst.defId]
          const port = idef && idef.ports.find((p) => p.id === m.portId)
          if (port && port.direction === 'output') {
            name = uniqueName(`${inst!.name}_${port.name || port.id}`, used)
            width = pinWidth(design, def, m)
            break
          }
        }
      }
      if (name === null) { name = uniqueName('z', used); width = 1 }
      for (const m of members) netNameOfPin.set(pinKey(m), name)
      netWidthByName.set(name, width)

      for (const o of outputs) {
        if (o.name !== name) bridges.push(`assign ${o.name} = ${name};`)
      }
    }

    // Floating-input warnings.
    for (const inst of instances) {
      const idef = design.defs[inst.defId]
      if (!idef || inst.id === inputGroup?.id || inst.id === outputGroup?.id) continue
      for (const p of inputPorts(idef)) {
        if (!findConnectionTo(connections, { instanceId: inst.id, portId: p.id })) {
          this.error(`floating input "${inst.name}.${p.name}" in composite "${def.name}"`)
        }
      }
    }
    if (outputGroup) {
      for (const p of outputPorts(def)) {
        if (!findConnectionTo(connections, { instanceId: outputGroup.id, portId: p.id })) {
          this.error(`floating output "${p.name}" in composite "${def.name}"`)
        }
      }
    }

    const netOf = (pin: PinRef): string => netNameOfPin.get(pinKey(pin))!

    // DFF Q nets are `reg` (the register output); derived outputs (e.g. !Q) are `assign`ed.
    const regNets = new Set<string>()
    for (const inst of instances) {
      const idef = design.defs[inst.defId]
      if (idef?.kind === 'primitive' && idef.primitive === 'dff') {
        const out = outputPorts(idef)[0]
        if (out) regNets.add(netOf({ instanceId: inst.id, portId: out.id }))
      }
    }

    const moduleName = this.defToModule.get(def.id)!

    const portDecls = ports.map((p) => {
      const isReg = p.dir === 'output' && regNets.has(p.name)
      const w = p.width > 1 ? ` [${p.width - 1}:0]` : ''
      const dir = isReg ? 'output reg' : p.dir
      return `${dir}${w} ${p.name}`
    })

    const portNames = new Set(ports.map((p) => p.name))
    const allNetNames = new Set(netNameOfPin.values())
    const decls: string[] = []
    for (const nm of [...allNetNames].sort()) {
      if (portNames.has(nm)) continue
      const w = netWidthByName.get(nm) ?? 1
      decls.push(regNets.has(nm) ? (w > 1 ? `reg [${w - 1}:0] ${nm};` : `reg ${nm};`) : (w > 1 ? `wire [${w - 1}:0] ${nm};` : `wire ${nm};`))
    }

    const stmts: string[] = []
    stmts.push(...bridges)
    const emitPrimitive = (inst: Instance, idef: PrimitiveDef): void => {
      const k = idef.primitive
      const pin = (id: string): PinRef => ({ instanceId: inst.id, portId: id })
      const net = (id: string): string => netOf(pin(id))
      const inv = (port: { inverted?: boolean } | undefined, s: string): string => (port?.inverted ? `~(${s})` : s)

      if (k === 'and' || k === 'or' || k === 'xor' || k === 'not' || k === 'buffer' || k === 'join-point') {
        const op = k === 'and' ? ' & ' : k === 'or' ? ' | ' : k === 'xor' ? ' ^ ' : null
        const inputs = inputPorts(idef)
        const output = outputPorts(idef)[0]
        const terms = inputs.map((p) => inv(p, net(p.id)))
        let rhs: string
        if (op === null) rhs = terms[0] ?? "1'b0"
        else if (terms.length === 1) rhs = terms[0]
        else rhs = terms.join(op)
        if (output.inverted) rhs = `~(${rhs})`
        stmts.push(`assign ${net(output.id)} = ${rhs};`)
        return
      }

      if (k === 'fan-in') {
        const inputs = inputPorts(idef)
        const output = outputPorts(idef)[0]
        const terms = inputs.map((p) => inv(p, net(p.id)))
        let rhs = `{${terms.slice().reverse().join(', ')}}`
        if (output.inverted) rhs = `~(${rhs})`
        stmts.push(`assign ${net(output.id)} = ${rhs};`)
        return
      }

      if (k === 'fan-out') {
        const input = inputPorts(idef)[0]
        const outputs = outputPorts(idef)
        outputs.forEach((p, i) => {
          let rhs = `${net(input.id)}[${i}]`
          if (input.inverted) rhs = `~(${rhs})`
          if (p.inverted) rhs = `~(${rhs})`
          stmts.push(`assign ${net(p.id)} = ${rhs};`)
        })
        return
      }

      if (k === 'bus-split') {
        const input = inputPorts(idef)[0]
        const [y1, y2] = outputPorts(idef)
        const n = netWidthByName.get(net(input.id)) ?? 1
        const m = Math.max(1, n >> 1)
        let r1 = `${net(input.id)}[${m - 1}:0]`
        let r2 = `${net(input.id)}[${n - 1}:${m}]`
        if (input.inverted) { r1 = `~(${r1})`; r2 = `~(${r2})` }
        if (y1.inverted) r1 = `~(${r1})`
        if (y2.inverted) r2 = `~(${r2})`
        stmts.push(`assign ${net(y1.id)} = ${r1};`)
        stmts.push(`assign ${net(y2.id)} = ${r2};`)
        return
      }

      if (k === 'bus-merge') {
        const [a, b] = inputPorts(idef)
        const output = outputPorts(idef)[0]
        let rhs = `{${inv(b, net(b.id))}, ${inv(a, net(a.id))}}`
        if (output.inverted) rhs = `~(${rhs})`
        stmts.push(`assign ${net(output.id)} = ${rhs};`)
        return
      }

      if (k === 'bus') {
        const input = inputPorts(idef)[0]
        const output = outputPorts(idef)[0]
        let rhs = inv(input, net(input.id))
        if (output.inverted) rhs = `~(${rhs})`
        stmts.push(`assign ${net(output.id)} = ${rhs};`)
        return
      }

      if (k === 'dff') {
        const prim = primitiveOf('dff')
        const clkId = prim.clockPortId?.() ?? 'in:1'
        const rstId = prim.resetPortId?.() ?? 'in:2'
        const complementId = prim.complementPortId?.() ?? null
        const dPort = inputPorts(idef).find((p) => p.id !== clkId && p.id !== rstId)
        const clkPort = idef.ports.find((p) => p.id === clkId)
        const rstPort = idef.ports.find((p) => p.id === rstId)
        const qPort = outputPorts(idef)[0]
        const d = dPort ? net(dPort.id) : ''
        const clk = net(clkId)
        const rst = net(rstId)
        const q = net(qPort.id)
        const qInverted = qPort.inverted === true
        const clkInverted = clkPort?.inverted === true
        const rstInverted = rstPort?.inverted === true
        const edgeProp = inst.props?.edge === 'negedge' ? 'negedge' : 'posedge'
        const resetActiveHigh = inst.props?.resetActiveHigh !== false
        const init = inst.props?.initialValue === true ? "1'b1" : "1'b0"
        const effEdge = clkInverted ? (edgeProp === 'posedge' ? 'negedge' : 'posedge') : edgeProp
        const effActiveHigh = rstInverted ? !resetActiveHigh : resetActiveHigh
        const qv = (expr: string): string => (qInverted ? `~(${expr})` : expr)
        const dSig = dPort?.inverted ? `~(${d})` : d

        const rstConnected = findConnectionTo(connections, { instanceId: inst.id, portId: rstId }) !== null
        if (rstConnected) {
          const rstKw = effActiveHigh ? 'posedge' : 'negedge'
          const rstCond = effActiveHigh ? rst : `!${rst}`
          stmts.push(`always @(${effEdge} ${clk} or ${rstKw} ${rst}) if (${rstCond}) ${q} <= ${qv(init)}; else ${q} <= ${qv(dSig)};`)
        } else {
          stmts.push(`always @(${effEdge} ${clk}) ${q} <= ${qv(dSig)};`)
        }
        // Derived outputs (e.g. the internally-complemented `!Q`): continuous assignments
        // from Q. A pin is inverted when its own bubble, its internal complement, and Q's
        // bubble differ — i.e. an odd number of inversions.
        for (const p of outputPorts(idef).slice(1)) {
          const complement = p.id === complementId
          const invertFromQ = (p.inverted === true) !== complement !== qInverted
          stmts.push(`assign ${net(p.id)} = ${invertFromQ ? `~(${q})` : q};`)
        }
        return
      }

      // Sources/sinks (clock/switch/led/7-seg) are handled in the statement loop.
    }

    const emitCompositeInstance = (inst: Instance, childDef: CompositeDef): void => {
      const childModule = this.defToModule.get(childDef.id)!
      const childPorts = this.computePortNames(childDef.id)
      const iname = uniqueName(inst.name || 'u', used)
      const conns = childDef.ports.map(
        (p) => `    .${childPorts.get(p.id)}(${netOf({ instanceId: inst.id, portId: p.id })})`,
      )
      stmts.push(`${childModule} ${iname} (\n${conns.join(',\n')}\n  );`)
    }

    for (const inst of instances) {
      if (inst.id === inputGroup?.id || inst.id === outputGroup?.id) continue
      const idef = design.defs[inst.defId]
      if (!idef) continue
      if (idef.kind === 'composite') {
        emitCompositeInstance(inst, idef)
        continue
      }
      if (idef.primitive === 'clock' || idef.primitive === 'led-array' || idef.primitive === 'seven-seg') {
        // Root instances are module ports; nested ones are skipped (warning already emitted).
        continue
      }
      if (idef.primitive === 'switch-array') {
        // Root switches are module inputs; nested switches become a fixed constant.
        if (!isRoot) {
          const init = inst.props?.initialValue === true ? 1 : 0
          for (const p of outputPorts(idef)) {
            const w = netWidthByName.get(netOf({ instanceId: inst.id, portId: p.id })) ?? 1
            stmts.push(`assign ${netOf({ instanceId: inst.id, portId: p.id })} = {${w}{1'b${init}}};`)
          }
        }
        continue
      }
      emitPrimitive(inst, idef)
    }

    const lines: string[] = []
    lines.push(`module ${moduleName} (`)
    if (portDecls.length === 0) {
      lines[lines.length - 1] += ');'
    } else {
      lines.push(...portDecls.map((d) => `  ${d},`))
      lines[lines.length - 1] = lines[lines.length - 1].replace(/,\s*$/, '')
      lines.push(');')
    }
    const body = [...decls, ...stmts].map((s) => `  ${s}`).join('\n')
    if (body) lines.push(body)
    lines.push('endmodule')
    return lines.join('\n')
  }
}

/** Turn serialized design JSON (`serializeDesign` output) into synthesizable Verilog. */
export function exportVerilog(json: string): VerilogResult {
  const parsed = withBuiltinPrimitives(parseDesign(json))
  const { design, issues } = sanitizeDesign(parsed)
  const verilogIssues: VerilogIssue[] = issues.map((i) => ({
    level: 'error' as const,
    message:
      i.type === 'dangling-connection'
        ? `removed dangling connection ${i.connectionId} in "${i.defId}"`
        : `removed dangling instance "${i.instanceName ?? i.instanceId}" in "${i.defId}"`,
  }))
  const gen = new Generator(design, verilogIssues)
  return { source: gen.generate(), issues: verilogIssues }
}
