/** @jest-environment jsdom */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { OpportunityResearchMode } from '@/app/opportunities/opportunity-research-mode'

describe('Situation research mode mobile hierarchy', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'app/opportunities/opportunity-research-mode.tsx'),
    'utf8',
  )
  const styles = readFileSync(
    resolve(process.cwd(), 'app/opportunities/opportunity-research-mode.module.css'),
    'utf8',
  )

  it('collapses secondary research controls behind one accessible button on narrow screens', () => {
    expect(source).toContain("'use client'")
    expect(source).toContain('className={disclosureStyles.mobileToggle}')
    expect(source).toContain('aria-expanded={mobileOpen}')
    expect(source).toContain('aria-controls="situation-research-controls"')
    expect(source).toContain('<span>Поиск и фильтры</span>')
    expect(source).toContain('<small>{viewLabel(props.view)}</small>')
    expect(styles).toContain('@media (max-width: 680px)')
    expect(styles).toMatch(/\.mobileToggle\s*\{[^}]*min-height:\s*48px/)
    expect(styles).toMatch(/\.researchControls\s*\{[^}]*display:\s*none/)
    expect(styles).toMatch(/\.researchControls\[data-mobile-open="true"\]\s*\{[^}]*display:\s*grid/)
  })

  it('keeps explicit criteria visible and resets disclosure state when the route view changes', () => {
    expect(source).toContain('const hasExplicitCriteria = Boolean(props.query || props.confidenceGate)')
    expect(source).toContain('useState(hasExplicitCriteria)')
    expect(source).toContain('setMobileOpen(Boolean(props.query || props.confidenceGate))')
    expect(source).toContain('[props.view, props.query, props.confidenceGate]')
  })

  it('uses one control tree and contains no analytics child slot', () => {
    expect(source.match(/<ResearchControls \{\.\.\.props\} \/>/g)).toHaveLength(1)
    expect(source.match(/name="q"/g)).toHaveLength(1)
    expect(source.match(/name="gate"/g)).toHaveLength(1)
    expect(source.match(/aria-label="Представления ситуаций"/g)).toHaveLength(1)
    expect(source).not.toContain('props.children')
  })

  it('toggles the mobile disclosure without duplicating search controls', () => {
    render(React.createElement(OpportunityResearchMode, {
      view: 'morning',
      query: '',
      confidenceGate: '',
      workflowEnabled: false,
    }))

    const toggle = screen.getByRole('button', { name: /Поиск и фильтры/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('searchbox', { name: 'Компания или ситуация' })).toHaveLength(1)

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('starts expanded when an explicit search criterion is active', () => {
    render(React.createElement(OpportunityResearchMode, {
      view: 'morning',
      query: 'Север',
      confidenceGate: 'A',
      workflowEnabled: false,
    }))

    expect(screen.getByRole('button', { name: /Поиск и фильтры/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})
