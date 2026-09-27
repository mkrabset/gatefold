import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CommitInput } from './CommitInput'

afterEach(cleanup)

describe('CommitInput', () => {
  it('commits immediately on a native change event (inc/dec spinner click)', () => {
    const onCommit = vi.fn()
    render(<CommitInput type="number" defaultValue="10" onCommit={onCommit} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '11' } })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('11')
  })

  it('commits a typed value on blur', () => {
    const onCommit = vi.fn()
    render(<CommitInput defaultValue="10" onCommit={onCommit} />)
    const input = screen.getByRole('textbox')
    fireEvent.input(input, { target: { value: '14' } })
    fireEvent.focusOut(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('14')
  })

  it('does not commit twice when a change is followed by blur', () => {
    const onCommit = vi.fn()
    render(<CommitInput type="number" defaultValue="10" onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '11' } })
    fireEvent.focusOut(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('commits on Enter', () => {
    const onCommit = vi.fn()
    render(<CommitInput defaultValue="10" onCommit={onCommit} />)
    const input = screen.getByRole('textbox')
    fireEvent.input(input, { target: { value: '12' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('12')
  })

  it('does not commit on blur when the value is unchanged', () => {
    const onCommit = vi.fn()
    render(<CommitInput defaultValue="10" onCommit={onCommit} />)
    fireEvent.focusOut(screen.getByRole('textbox'))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('flushes a pending value on unmount', () => {
    const onCommit = vi.fn()
    const { unmount } = render(<CommitInput defaultValue="10" onCommit={onCommit} />)
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '13' } })
    unmount()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('13')
  })
})
