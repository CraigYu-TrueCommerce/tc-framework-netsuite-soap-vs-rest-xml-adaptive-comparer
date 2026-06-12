import { describe, expect, it } from 'vitest'
import { compareXml, DEFAULT_RULES } from './comparer'

const SOAP = `<TcBspFrameworkResponse><ResponseData><Transaction><TransactionData><Invoice><subTotal>10.00</subTotal><billingAddress><phone>(815) 389-3606</phone></billingAddress><itemList><item><line>1</line><item>SKU-A</item><amount>10</amount></item></itemList></Invoice></TransactionData></Transaction></ResponseData></TcBspFrameworkResponse>`
const REST = `<Envelope><Invoice><subtotal>10</subtotal><billingAddress><addrPhone>+1 815-389-3606</addrPhone></billingAddress><itemList><item><line>1</line><item>SKU-A</item><tcDiscountItem><item><amount>10.00</amount></item></tcDiscountItem></item></itemList></Invoice></Envelope>`

describe('compareXml', () => {
  it('supports adaptive aliases and nested penetration', () => {
    const report = compareXml(SOAP, REST, 'adaptive', DEFAULT_RULES)
    expect(report.summary.compatibilityScore).toBeGreaterThan(70)
    expect(report.entries.some((e) => e.status === 'structuralMatch')).toBe(true)
  })

  it('keeps strict mode stricter than adaptive mode', () => {
    const strict = compareXml(SOAP, REST, 'strict', DEFAULT_RULES)
    const adaptive = compareXml(SOAP, REST, 'adaptive', DEFAULT_RULES)
    expect(strict.summary.valueDifferences + strict.summary.missingFromCandidate).toBeGreaterThan(
      adaptive.summary.valueDifferences + adaptive.summary.missingFromCandidate,
    )
  })
})
