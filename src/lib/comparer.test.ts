import { describe, expect, it } from 'vitest'
import { compareXml, DEFAULT_RULES, reportToHtml } from './comparer'

const SOAP = `<TcBspFrameworkResponse><ResponseData><Transaction><TransactionData><Invoice><subTotal>10.00</subTotal><billingAddress><phone>(815) 389-3606</phone></billingAddress><itemList><item><line>1</line><item>SKU-A</item><amount>10</amount></item></itemList></Invoice></TransactionData></Transaction></ResponseData></TcBspFrameworkResponse>`
const REST = `<Envelope><Invoice><subtotal>10</subtotal><billingAddress><addrPhone>+1 815-389-3606</addrPhone></billingAddress><itemList><item><line>1</line><item>SKU-A</item><tcDiscountItem><item><amount>10.00</amount></item></tcDiscountItem></item></itemList></Invoice></Envelope>`

describe('compareXml', () => {
  it('compares without compatibility aliases or ignore rules', () => {
    const report = compareXml(SOAP, REST, 'adaptive', DEFAULT_RULES)
    expect(DEFAULT_RULES.pathAliases).toEqual({})
    expect(DEFAULT_RULES.ignorePaths).toEqual([])
    expect(DEFAULT_RULES.nestedPathAliases).toEqual({})
    expect(report.entries.some((e) => e.soapPath?.includes('phone'))).toBe(true)
    expect(report.entries.some((e) => e.restPath?.includes('addrPhone'))).toBe(true)
  })

  it('keeps normalized mode value normalization while avoiding compatibility mappings', () => {
    const strict = compareXml(SOAP, REST, 'strict', DEFAULT_RULES)
    const adaptive = compareXml(SOAP, REST, 'normalized', DEFAULT_RULES)
    expect(strict.summary.valueDifferences + strict.summary.missingFromCandidate).toBeGreaterThan(
      adaptive.summary.valueDifferences + adaptive.summary.missingFromCandidate,
    )
  })

  it('sorts same-level text nodes before nested nodes while keeping each group alphabetical', () => {
    const soap =
      '<Envelope><Invoice><nestedA><c>3</c></nestedA><b>2</b><nestedB><c>4</c></nestedB><a z="2" a="1">1</a></Invoice></Envelope>'
    const rest = '<Root><Invoice><a a="1" z="2">1</a><b>3</b></Invoice></Root>'
    const report = compareXml(soap, rest, 'normalized', DEFAULT_RULES)

    expect(report.sortedXml.soap).toContain(
      '<a a="1" z="2">1</a>\n  <b>2</b>\n  <nestedA>\n    <c>3</c>\n  </nestedA>\n  <nestedB>',
    )
    expect(report.sortedXml.soapLines.some((line) => line.different)).toBe(true)
    expect(report.sortedXml.restLines.some((line) => line.different)).toBe(true)
  })

  it('aligns side-by-side XML diff lines with blank placeholders and highlight types', () => {
    const soap = '<Envelope><Invoice><a>1</a></Invoice></Envelope>'
    const rest = '<Root><Invoice><a>1</a><b>2</b></Invoice></Root>'
    const report = compareXml(soap, rest, 'normalized', DEFAULT_RULES)

    expect(report.sortedXml.soapLines).toHaveLength(report.sortedXml.restLines.length)
    expect(report.sortedXml.soapLines.some((line) => line.different && line.text === '' && line.highlight === 'info')).toBe(
      true,
    )
    expect(report.sortedXml.restLines.some((line) => line.text.includes('<b>2</b>') && line.highlight === 'info')).toBe(
      true,
    )
  })

  it('adds a shared blank separator instead of pairing unrelated large diff blocks', () => {
    const soapChildren = Array.from({ length: 13 }, (_, index) => `<soap${index}>${index}</soap${index}>`).join('')
    const restChildren = Array.from({ length: 13 }, (_, index) => `<rest${index}>${index}</rest${index}>`).join('')
    const report = compareXml(`<Invoice>${soapChildren}</Invoice>`, `<Invoice>${restChildren}</Invoice>`, 'normalized', DEFAULT_RULES)

    expect(report.sortedXml.soapLines.some((line) => line.text === '' && !line.different)).toBe(true)
    expect(report.sortedXml.restLines.some((line) => line.text === '' && !line.different)).toBe(true)
  })

  it('exports the CodeMirror-style sorted diff as an HTML report', () => {
    const report = compareXml('<Invoice><a>&amp;</a></Invoice>', '<Invoice><a>2</a></Invoice>', 'normalized', DEFAULT_RULES)
    const html = reportToHtml(report)

    expect(html).toContain('<title>XML Compare Report</title>')
    expect(html).toContain('SOAP / Baseline sorted XML')
    expect(html).toContain('&amp;amp;')
    expect(html).toContain('Changed Entries')
  })
})
