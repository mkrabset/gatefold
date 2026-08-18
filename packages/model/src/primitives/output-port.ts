import { PortGroup } from './port-group'

/**
 * The internal `output-port` primitive. A single instance carries all of a composite's
 * output ports (its pins are derived from the parent, acting as sinks).
 */
export class OutputPort extends PortGroup {
  readonly kind = 'output-port' as const
  readonly label = 'output-port'

  portGroupDirection(): 'output' {
    return 'output'
  }
}
