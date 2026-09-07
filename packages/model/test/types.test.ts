import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design } from '../src/types'
import { templateCategories, templateCategory, UNCATEGORIZED } from '../src/composite'

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

describe('templateCategories', () => {
  it('lists distinct, sorted categories across the origin templates', () => {
    const design: Design = {
      version: 2,
      root: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      library: {
        a: { ...def('Logic'), id: 'a' },
        b: { ...def('Arithmetic'), id: 'b' },
        c: { ...def(undefined), id: 'c' },
        d: { ...def('Logic'), id: 'd' },
      },
    }
    expect(templateCategories(design)).toEqual(['Arithmetic', 'Logic', UNCATEGORIZED])
  })

  it('returns an empty list when the library is empty', () => {
    const design: Design = {
      version: 2,
      root: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      library: {},
    }
    expect(templateCategories(design)).toEqual([])
  })
})
