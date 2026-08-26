import { readFileSync, writeFileSync } from 'node:fs'
import { exportVerilog } from './index'

const args = process.argv.slice(2)
if (args.length < 1) {
  console.error('Usage: gatefold-verilog <input.json> [output.v]')
  process.exit(1)
}

const json = readFileSync(args[0], 'utf8')
const { source, issues } = exportVerilog(json)

for (const issue of issues) console.error(`${issue.level}: ${issue.message}`)

if (args[1]) {
  writeFileSync(args[1], source)
  console.error(`wrote ${args[1]}`)
} else {
  process.stdout.write(source)
}
