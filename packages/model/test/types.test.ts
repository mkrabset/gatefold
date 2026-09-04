import { describe, expect, it } from 'vitest'
import type { CompositeDef } from '../src/types'
import { templateCategory, UNCATEGORIZED } from '../src/types'

const def = (category?: string): CompositeDef => ({
  id: 'x',
  name: 'x',
  kind: 'composite',
  ports: [],
  instances: [],
  connections: [],
  category,
})

describe('templateCategory', () => {
  it('defaults to Uncategorized when the category is unset', () => {
    expect(templateCategory(def(undefined))).toBe(UNCATEGORIZED)
  })

  it('defaults to Uncategorized when the category is blank', () => {
    expect(templateCategory(def('   '))).toBe(UNCATEGORIZED)
  })

  it('returns the trimmed category otherwise', () => {
    expect(templateCategory(def('  Arithmetic  '))).toBe('Arithmetic')
  })
})
