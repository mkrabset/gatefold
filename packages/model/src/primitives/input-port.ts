import { PortGroup } from './port-group'

/**
 * The internal `input-port` primitive. A single instance carries all of a composite's
 * input ports (its pins are derived from the parent, acting as sources).
 */
export class InputPort extends PortGroup {
  readonly kind = 'input-port' as const
  readonly label = 'input-port'

  portGroupDirection(): 'input' {
    return 'input'
  }
}
