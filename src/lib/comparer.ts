export type CompareMode = 'strict' | 'normalized' | 'adaptive'

export interface CollectionRule {
  path: string
  matchBy: string[]
}

export interface RulesConfig {
  pathAliases: Record<string, string>
  valueAliases: Record<string, string>
  ignorePaths: string[]
  collectionMatchRules: CollectionRule[]
  nestedPathAliases: Record<string, string>
  normalizers: {
    trimWhitespace: boolean
    collapseWhitespace: boolean
    numeric: boolean
    percent: boolean
    boolean: boolean
    date: boolean
    phone: boolean
  }
  emptyZeroRelationship: 'strict' | 'warning'
  extraCandidateSeverity: 'info' | 'warning' | 'critical'
}

export interface CompareEntry {
  severity: 'critical' | 'warning' | 'info'
  status:
    | 'exactMatch'
    | 'normalizedMatch'
    | 'valueMismatch'
    | 'missingFromCandidate'
    | 'extraInCandidate'
    | 'structuralMatch'
  canonicalPath: string
  soapPath?: string
  restPath?: string
  soapValue?: string
  restValue?: string
  note: string
}

export interface CompareReport {
  mode: CompareMode
  summary: {
    matched: number
    normalizedWarnings: number
    valueDifferences: number
    missingFromCandidate: number
    extraInCandidate: number
    structuralMatches: number
    compatibilityScore: number
  }
  sortedXml: {
    soap: string
    rest: string
    soapLines: XmlDiffLine[]
    restLines: XmlDiffLine[]
  }
  entries: CompareEntry[]
}

export interface XmlDiffLine {
  lineNumber: number
  text: string
  different: boolean
  highlight?: 'critical' | 'warning' | 'info'
  caseDiffRanges?: TextRange[]
  valueDiffRanges?: TextRange[]
}

export interface TextRange {
  from: number
  to: number
}

interface ValueRecord {
  path: string
  value: string
}

interface NormalizedValue {
  canonical: string
  normalizedBy: string[]
}

export const DEFAULT_RULES: RulesConfig = {
  pathAliases: {},
  valueAliases: {},
  ignorePaths: [],
  collectionMatchRules: [],
  nestedPathAliases: {},
  normalizers: {
    trimWhitespace: true,
    collapseWhitespace: true,
    numeric: true,
    percent: true,
    boolean: true,
    date: true,
    phone: true,
  },
  emptyZeroRelationship: 'warning',
  extraCandidateSeverity: 'info',
}

export const INVOICE_SAMPLE_SOAP = `<TcBspFrameworkResponse>
  <ResponseData>
    <Transaction>
      <TransactionData>
        <Invoice>
          <transactionId>INV-1001</transactionId>
          <subTotal>10.00</subTotal>
          <billingAddress>
            <phone>(815) 389-3606</phone>
          </billingAddress>
          <itemList>
            <item>
              <line>1</line>
              <item>SKU-A</item>
              <amount>10</amount>
            </item>
          </itemList>
        </Invoice>
      </TransactionData>
    </Transaction>
  </ResponseData>
</TcBspFrameworkResponse>`

export const INVOICE_SAMPLE_REST = `<Envelope>
  <Invoice>
    <transactionId>INV-1001</transactionId>
    <subtotal>10</subtotal>
    <billingAddress>
      <addrPhone>+1 815-389-3606</addrPhone>
    </billingAddress>
    <itemList>
      <item>
        <line>1</line>
        <item>SKU-A</item>
        <tcDiscountItem>
          <item>
            <amount>10.00</amount>
          </item>
        </tcDiscountItem>
      </item>
    </itemList>
  </Invoice>
</Envelope>`

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const US_DATE_TIME = /^\d{1,2}\/\d{1,2}\/\d{4}(\s+\d{1,2}:\d{2}:\d{2}(\s?[AP]M)?)?$/i

type TrustedPolicyFactory = {
  createPolicy: (name: string, rules: { createHTML: (input: string) => string }) => {
    createHTML: (input: string) => string
  }
}

const trustedTypesFactory: TrustedPolicyFactory | undefined =
  typeof window !== 'undefined'
    ? (window as Window & { trustedTypes?: TrustedPolicyFactory }).trustedTypes
    : undefined

const trustedXmlPolicy = trustedTypesFactory
  ? trustedTypesFactory.createPolicy('xml-compare-policy', {
      createHTML: (input: string) => input,
    })
  : null

export function compareXml(
  soapXml: string,
  restXml: string,
  mode: CompareMode,
  rules: RulesConfig,
): CompareReport {
  const soapDoc = parseXml(soapXml)
  const restDoc = parseXml(restXml)

  const soapRoot = findBusinessRoot(soapDoc)
  const restRoot = findBusinessRoot(restDoc)
  const sortedSoapXml = serializeSortedXml(soapDoc.documentElement)
  const sortedRestXml = serializeSortedXml(restDoc.documentElement)

  const soapRecords = flatten(soapRoot, 'Invoice', mode === 'adaptive', rules)
  const restRecords = flatten(restRoot, 'Invoice', mode === 'adaptive', rules)

  const entries: CompareEntry[] = []

  const soapByPath = groupByCanonicalPath(soapRecords, mode, rules)
  const restByPath = groupByCanonicalPath(restRecords, mode, rules)

  const allPaths = new Set([...soapByPath.keys(), ...restByPath.keys()])

  for (const path of [...allPaths].sort()) {
    if (isIgnoredPath(path, rules.ignorePaths)) {
      continue
    }

    const soapValues = soapByPath.get(path) ?? []
    const restValues = restByPath.get(path) ?? []

    const matchedRest = new Set<number>()

    for (const soapValue of soapValues) {
      const matchIndex = findBestMatch(soapValue, restValues, matchedRest, mode, rules, path)
      if (matchIndex === -1) {
        entries.push({
          severity: 'critical',
          status: 'missingFromCandidate',
          canonicalPath: path,
          soapPath: soapValue.path,
          soapValue: soapValue.value,
          note: 'SOAP field/value missing in REST candidate',
        })
        continue
      }

      matchedRest.add(matchIndex)
      const restValue = restValues[matchIndex]
      entries.push(buildMatchEntry(path, soapValue, restValue, mode, rules))
    }

    restValues.forEach((restValue, index) => {
      if (!matchedRest.has(index)) {
        entries.push({
          severity: rules.extraCandidateSeverity,
          status: 'extraInCandidate',
          canonicalPath: path,
          restPath: restValue.path,
          restValue: restValue.value,
          note: 'Extra field/value in REST candidate',
        })
      }
    })
  }

  const summary = buildSummary(entries)
  return {
    mode,
    entries,
    summary,
    sortedXml: {
      soap: sortedSoapXml,
      rest: sortedRestXml,
      ...buildLineDiff(sortedSoapXml, sortedRestXml),
    },
  }
}


function parseXml(xml: string): Document {
  const parser = new DOMParser()
  const trustedXml = trustedXmlPolicy ? trustedXmlPolicy.createHTML(xml) : xml
  const doc = parser.parseFromString(String(trustedXml), 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent ?? 'unknown parser error'}`)
  }
  return doc
}

function serializeSortedXml(element: Element): string {
  return serializeElement(element, 0)
}

function serializeElement(element: Element, depth: number): string {
  const indent = '  '.repeat(depth)
  const attributes = [...element.attributes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((attribute) => `${attribute.name}="${escapeXml(attribute.value)}"`)
    .join(' ')
  const openTag = attributes ? `<${element.tagName} ${attributes}>` : `<${element.tagName}>`
  const childElements = [...element.children] as Element[]

  if (childElements.length === 0) {
    return `${indent}${openTag}${escapeXml((element.textContent ?? '').trim())}</${element.tagName}>`
  }

  const sortedChildren = childElements.sort(compareSortableElements)
  const children = sortedChildren.map((child) => serializeElement(child, depth + 1)).join('\n')

  return `${indent}${openTag}\n${children}\n${indent}</${element.tagName}>`
}

function compareSortableElements(a: Element, b: Element): number {
  const typeCompare = Number(hasNestedElements(a)) - Number(hasNestedElements(b))
  if (typeCompare !== 0) return typeCompare

  const tagCompare = a.tagName.toLowerCase().localeCompare(b.tagName.toLowerCase())
  if (tagCompare !== 0) return tagCompare

  const caseCompare = a.tagName.localeCompare(b.tagName)
  if (caseCompare !== 0) return caseCompare

  return sortableElementText(a).localeCompare(sortableElementText(b))
}

function hasNestedElements(element: Element): boolean {
  return element.children.length > 0
}

function sortableElementText(element: Element): string {
  return `${element.tagName}\u0000${[...element.attributes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((attribute) => `${attribute.name}=${attribute.value}`)
    .join('\u0000')}\u0000${(element.textContent ?? '').trim()}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildLineDiff(
  soapXml: string,
  restXml: string,
): {
  soapLines: XmlDiffLine[]
  restLines: XmlDiffLine[]
} {
  const soapLines = soapXml.split('\n')
  const restLines = restXml.split('\n')
  const alignedLines = alignLines(soapLines, restLines)

  return {
    soapLines: alignedLines.map((line, index) => ({
      lineNumber: index + 1,
      text: line.soapText,
      different: line.type !== 'equal',
      highlight: line.soapHighlight,
      caseDiffRanges: line.soapCaseDiffRanges,
      valueDiffRanges: line.soapValueDiffRanges,
    })),
    restLines: alignedLines.map((line, index) => ({
      lineNumber: index + 1,
      text: line.restText,
      different: line.type !== 'equal',
      highlight: line.restHighlight,
      caseDiffRanges: line.restCaseDiffRanges,
      valueDiffRanges: line.restValueDiffRanges,
    })),
  }
}

type RawDiffOperation =
  | { type: 'equal'; soapText: string; restText: string }
  | { type: 'delete'; soapText: string }
  | { type: 'insert'; restText: string }

interface AlignedDiffLine {
  type: 'equal' | 'changed' | 'missingFromRest' | 'extraInRest'
  soapText: string
  restText: string
  soapHighlight?: XmlDiffLine['highlight']
  restHighlight?: XmlDiffLine['highlight']
  soapCaseDiffRanges?: TextRange[]
  restCaseDiffRanges?: TextRange[]
  soapValueDiffRanges?: TextRange[]
  restValueDiffRanges?: TextRange[]
}

function alignLines(soapLines: string[], restLines: string[]): AlignedDiffLine[] {
  if (soapLines.length * restLines.length > 250000) {
    return alignLinesByPosition(soapLines, restLines)
  }

  const lcs = Array.from({ length: soapLines.length + 1 }, () => Array(restLines.length + 1).fill(0) as number[])

  for (let i = soapLines.length - 1; i >= 0; i -= 1) {
    for (let j = restLines.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        soapLines[i] === restLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const operations: RawDiffOperation[] = []
  let soapIndex = 0
  let restIndex = 0
  while (soapIndex < soapLines.length || restIndex < restLines.length) {
    if (soapIndex < soapLines.length && restIndex < restLines.length && soapLines[soapIndex] === restLines[restIndex]) {
      operations.push({ type: 'equal', soapText: soapLines[soapIndex], restText: restLines[restIndex] })
      soapIndex += 1
      restIndex += 1
    } else if (restIndex >= restLines.length || lcs[soapIndex + 1]?.[restIndex] >= lcs[soapIndex]?.[restIndex + 1]) {
      operations.push({ type: 'delete', soapText: soapLines[soapIndex] })
      soapIndex += 1
    } else {
      operations.push({ type: 'insert', restText: restLines[restIndex] })
      restIndex += 1
    }
  }

  return pairChangedLines(operations)
}

function alignLinesByPosition(soapLines: string[], restLines: string[]): AlignedDiffLine[] {
  const operations: RawDiffOperation[] = []
  let soapIndex = 0
  let restIndex = 0
  const lookahead = 200

  while (soapIndex < soapLines.length || restIndex < restLines.length) {
    if (soapIndex >= soapLines.length) {
      operations.push({ type: 'insert', restText: restLines[restIndex] })
      restIndex += 1
      continue
    }
    if (restIndex >= restLines.length) {
      operations.push({ type: 'delete', soapText: soapLines[soapIndex] })
      soapIndex += 1
      continue
    }

    const currentSoapSignature = lineSignature(soapLines[soapIndex])
    const currentRestSignature = lineSignature(restLines[restIndex])
    if (
      soapLines[soapIndex] === restLines[restIndex] ||
      (currentSoapSignature !== null && currentSoapSignature === currentRestSignature)
    ) {
      operations.push({ type: 'delete', soapText: soapLines[soapIndex] })
      operations.push({ type: 'insert', restText: restLines[restIndex] })
      soapIndex += 1
      restIndex += 1
      continue
    }

    const restMatch = currentSoapSignature
      ? restLines
          .slice(restIndex + 1, restIndex + lookahead + 1)
          .findIndex((line) => lineSignature(line) === currentSoapSignature)
      : -1
    const soapMatch = currentRestSignature
      ? soapLines
          .slice(soapIndex + 1, soapIndex + lookahead + 1)
          .findIndex((line) => lineSignature(line) === currentRestSignature)
      : -1

    if (restMatch !== -1 && (soapMatch === -1 || restMatch <= soapMatch)) {
      operations.push({ type: 'insert', restText: restLines[restIndex] })
      restIndex += 1
      continue
    }
    if (soapMatch !== -1) {
      operations.push({ type: 'delete', soapText: soapLines[soapIndex] })
      soapIndex += 1
      continue
    }

    operations.push({ type: 'delete', soapText: soapLines[soapIndex] })
    operations.push({ type: 'insert', restText: restLines[restIndex] })
    soapIndex += 1
    restIndex += 1
  }

  return pairChangedLines(operations)
}

function pairChangedLines(operations: RawDiffOperation[]): AlignedDiffLine[] {
  const alignedLines: AlignedDiffLine[] = []
  let index = 0

  while (index < operations.length) {
    const operation = operations[index]
    if (operation.type === 'equal') {
      alignedLines.push({ type: 'equal', soapText: operation.soapText, restText: operation.restText })
      index += 1
      continue
    }

    const deletes: string[] = []
    const inserts: string[] = []
    while (operations[index]?.type === 'delete') {
      deletes.push((operations[index] as Extract<RawDiffOperation, { type: 'delete' }>).soapText)
      index += 1
    }
    while (operations[index]?.type === 'insert') {
      inserts.push((operations[index] as Extract<RawDiffOperation, { type: 'insert' }>).restText)
      index += 1
    }

    if (deletes.length > 0 && inserts.length > 0) {
      alignedLines.push(...alignChangedBlock(deletes, inserts))
      continue
    }

    deletes.forEach((soapText) => {
      alignedLines.push({ type: 'missingFromRest', soapText, restText: '', soapHighlight: 'critical', restHighlight: 'critical' })
    })

    inserts.forEach((restText) => {
      alignedLines.push({ type: 'extraInRest', soapText: '', restText })
    })
  }

  return alignedLines
}

function alignChangedBlock(deletes: string[], inserts: string[]): AlignedDiffLine[] {
  const alignedLines: AlignedDiffLine[] = []
  let deleteIndex = 0
  let insertIndex = 0

  while (deleteIndex < deletes.length || insertIndex < inserts.length) {
    if (deleteIndex >= deletes.length) {
      alignedLines.push({ type: 'extraInRest', soapText: '', restText: inserts[insertIndex] })
      insertIndex += 1
      continue
    }
    if (insertIndex >= inserts.length) {
      alignedLines.push({
        type: 'missingFromRest',
        soapText: deletes[deleteIndex],
        restText: '',
        soapHighlight: 'critical',
        restHighlight: 'critical',
      })
      deleteIndex += 1
      continue
    }

    const deleteSignature = lineSignature(deletes[deleteIndex])
    const insertSignature = lineSignature(inserts[insertIndex])
    if (deleteSignature && deleteSignature === insertSignature) {
      alignedLines.push(pairSameNodeLine(deletes[deleteIndex], inserts[insertIndex]))
      deleteIndex += 1
      insertIndex += 1
      continue
    }

    const nextInsertMatch = deleteSignature
      ? inserts.slice(insertIndex + 1).findIndex((line) => lineSignature(line) === deleteSignature)
      : -1
    const nextDeleteMatch = insertSignature
      ? deletes.slice(deleteIndex + 1).findIndex((line) => lineSignature(line) === insertSignature)
      : -1

    if (nextInsertMatch !== -1 && (nextDeleteMatch === -1 || nextInsertMatch <= nextDeleteMatch)) {
      alignedLines.push({ type: 'extraInRest', soapText: '', restText: inserts[insertIndex] })
      insertIndex += 1
      continue
    }

    if (nextDeleteMatch !== -1) {
      alignedLines.push({
        type: 'missingFromRest',
        soapText: deletes[deleteIndex],
        restText: '',
        soapHighlight: 'critical',
        restHighlight: 'critical',
      })
      deleteIndex += 1
      continue
    }

    alignedLines.push({
      type: 'missingFromRest',
      soapText: deletes[deleteIndex],
      restText: '',
      soapHighlight: 'critical',
      restHighlight: 'critical',
    })
    alignedLines.push({ type: 'equal', soapText: '', restText: '' })
    alignedLines.push({ type: 'extraInRest', soapText: '', restText: inserts[insertIndex] })
    deleteIndex += 1
    insertIndex += 1
  }

  return alignedLines
}

function pairSameNodeLine(soapText: string, restText: string): AlignedDiffLine {
  if (soapText === restText) {
    return { type: 'equal', soapText, restText }
  }

  const soapLeaf = parseLeafLine(soapText)
  const restLeaf = parseLeafLine(restText)
  if (soapLeaf && restLeaf && soapLeaf.tag.toLowerCase() === restLeaf.tag.toLowerCase()) {
    if (soapLeaf.value.trim() === '' && restLeaf.value.trim() !== '') {
      return { type: 'changed', soapText, restText }
    }

    if (soapLeaf.value !== restLeaf.value) {
      return {
        type: 'changed',
        soapText,
        restText,
        restHighlight: 'critical',
        restValueDiffRanges: [restLeaf.valueRange],
      }
    }
  }

  if (soapText.toLowerCase() === restText.toLowerCase()) {
    const ranges = buildCaseDiffRanges(soapText, restText)
    return {
      type: 'changed',
      soapText,
      restText,
      soapHighlight: 'warning',
      restHighlight: 'warning',
      soapCaseDiffRanges: ranges,
      restCaseDiffRanges: ranges,
    }
  }

  return { type: 'changed', soapText, restText, soapHighlight: 'critical', restHighlight: 'critical' }
}

function parseLeafLine(text: string): { tag: string; value: string; valueRange: TextRange } | null {
  const match = text.match(/^(\s*<([A-Za-z_][\w:.-]*)(?:\s+[^>]*)?>)(.*)(<\/\2>)$/)
  if (!match) return null

  const [, openingTag, tag, value] = match
  return {
    tag,
    value,
    valueRange: {
      from: openingTag.length,
      to: openingTag.length + value.length,
    },
  }
}

function buildCaseDiffRanges(soapText: string, restText: string): TextRange[] {
  const ranges: TextRange[] = []
  let activeStart: number | null = null

  for (let index = 0; index < soapText.length; index += 1) {
    const isCaseDiff =
      soapText[index] !== restText[index] && soapText[index].toLowerCase() === restText[index].toLowerCase()

    if (isCaseDiff && activeStart === null) {
      activeStart = index
    }

    if (!isCaseDiff && activeStart !== null) {
      ranges.push({ from: activeStart, to: index })
      activeStart = null
    }
  }

  if (activeStart !== null) {
    ranges.push({ from: activeStart, to: soapText.length })
  }

  return ranges
}

function lineSignature(value: string): string | null {
  const trimmed = value.trim()
  const indent = value.match(/^\s*/)?.[0].length ?? 0
  const tag = trimmed.match(/^<\/?([A-Za-z_][\w:.-]*)/)?.[1]
  if (!tag) return null

  const type = trimmed.startsWith('</') ? 'close' : trimmed.includes(`</${tag}>`) ? 'leaf' : 'open'
  return `${indent}:${type}:${tag.toLowerCase()}`
}

export function reportToHtml(report: CompareReport): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>XML Compare Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 1rem; color: #1f1f1f; font-size: 18px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1rem; margin: .75rem 0 1rem; }
    .summary-card, pre, table { border: 1px solid #ddd; }
    .summary-card { border-radius: 8px; overflow: hidden; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 8%); }
    .summary-card h2 { margin: 0; padding: .65rem .8rem; background: #f4f7fb; border-bottom: 1px solid #ddd; font-size: 1.05rem; }
    table { width: 100%; border-collapse: collapse; font-size: 1rem; }
    th, td { border: 1px solid #e2e2e2; padding: .55rem .65rem; text-align: left; }
    th { width: 62%; background: #fbfbfb; color: #444; font-weight: 600; }
    td { font-weight: 700; }
    .legend { display: flex; flex-wrap: wrap; gap: .5rem; margin: .75rem 0 1rem; }
    .legend span { border: 1px solid #ddd; border-left-width: 3px; padding: .3rem .45rem; }
    .diff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
    pre { margin: 0; padding: .75rem; overflow: auto; line-height: 1.5; background: #fff; font-size: 1.05rem; }
    .line { display: block; min-height: 1.4em; white-space: pre; }
    .critical { background: #fde7e9; border-left: 3px solid #c82333; }
    .warning { background: #fff3cd; border-left: 3px solid #d39e00; }
    .info { background: #e7f1ff; border-left: 3px solid #0b5ed7; }
    .case-char { background: #d39e00; color: #1f1f1f; font-weight: 700; }
    .value-char { background: #8b0000; color: #fff; font-weight: 700; }
    @media (max-width: 960px) { .diff-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>XML Compare Report</h1>
  <p>Mode: ${escapeHtml(report.mode)}</p>
  <section class="summary">
    <div class="summary-card">
      <h2>Match Quality</h2>
      <table>
        <tbody>
          <tr><th>Matched</th><td>${report.summary.matched}</td></tr>
          <tr><th>Normalized/Warnings</th><td>${report.summary.normalizedWarnings}</td></tr>
          <tr><th>Structural/adaptive matches</th><td>${report.summary.structuralMatches}</td></tr>
          <tr><th>Compatibility score</th><td>${report.summary.compatibilityScore}%</td></tr>
        </tbody>
      </table>
    </div>
    <div class="summary-card">
      <h2>Differences</h2>
      <table>
        <tbody>
          <tr><th>Value differences</th><td>${report.summary.valueDifferences}</td></tr>
          <tr><th>Missing from REST</th><td>${report.summary.missingFromCandidate}</td></tr>
          <tr><th>Extra in REST</th><td>${report.summary.extraInCandidate}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
  <section class="legend" aria-label="Highlight legend">
    <span class="critical">REST differs from SOAP or SOAP line is missing</span>
    <span class="warning">Same node name with different case only</span>
  </section>
  <section class="diff-grid">
    <article>
      <h2>SOAP / Baseline sorted XML</h2>
      <pre>${linesToHtml(report.sortedXml.soapLines)}</pre>
    </article>
    <article>
      <h2>REST / Candidate sorted XML</h2>
      <pre>${linesToHtml(report.sortedXml.restLines)}</pre>
    </article>
  </section>
</body>
</html>`
}

function linesToHtml(lines: XmlDiffLine[]): string {
  return lines
    .map((line) => {
      const className = line.highlight ? `line ${line.highlight}` : 'line'
      return `<span class="${className}">${lineTextToHtml(line)}</span>`
    })
    .join('\n')
}

function lineTextToHtml(line: XmlDiffLine): string {
  const ranges = [
    ...(line.caseDiffRanges ?? []).map((range) => ({ ...range, className: 'case-char' })),
    ...(line.valueDiffRanges ?? []).map((range) => ({ ...range, className: 'value-char' })),
  ].sort((a, b) => a.from - b.from)
  if (ranges.length === 0) {
    return escapeHtml(line.text)
  }

  let html = ''
  let index = 0
  for (const range of ranges) {
    html += escapeHtml(line.text.slice(index, range.from))
    html += `<span class="${range.className}">${escapeHtml(line.text.slice(range.from, range.to))}</span>`
    index = range.to
  }
  html += escapeHtml(line.text.slice(index))
  return html
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function findBusinessRoot(doc: Document): Element {
  const invoiceByPath = doc.querySelector(
    'TcBspFrameworkResponse > ResponseData > Transaction > TransactionData > Invoice',
  )
  if (invoiceByPath) {
    return invoiceByPath
  }

  const invoice = doc.querySelector('Invoice')
  if (invoice) {
    return invoice
  }

  return doc.documentElement
}

function flatten(
  node: Element,
  currentPath: string,
  adaptiveCollections: boolean,
  rules: RulesConfig,
): ValueRecord[] {
  const records: ValueRecord[] = []

  for (const attr of [...node.attributes]) {
    records.push({ path: `${currentPath}.@${attr.name}`, value: attr.value })
  }

  const childElements = [...node.children] as Element[]

  if (childElements.length === 0) {
    const text = node.textContent ?? ''
    records.push({ path: currentPath, value: text })
    return records
  }

  const grouped = new Map<string, Element[]>()
  for (const child of childElements) {
    const key = child.tagName
    grouped.set(key, [...(grouped.get(key) ?? []), child])
  }

  for (const [tag, group] of grouped) {
    if (group.length === 1) {
      records.push(...flatten(group[0], `${currentPath}.${tag}`, adaptiveCollections, rules))
      continue
    }

    group.forEach((child, index) => {
      const rowKey =
        adaptiveCollections && currentPath
          ? computeCollectionRowKey(currentPath, child, index, rules)
          : `${index + 1}`
      records.push(...flatten(child, `${currentPath}.${tag}[${rowKey}]`, adaptiveCollections, rules))
    })
  }

  return records
}

function computeCollectionRowKey(
  collectionParentPath: string,
  rowNode: Element,
  index: number,
  rules: RulesConfig,
): string {
  const collectionPath = `${collectionParentPath}.${rowNode.tagName}`.toLowerCase()
  const rule = rules.collectionMatchRules.find((r) => r.path.toLowerCase() === collectionPath)
  if (!rule) {
    return `${index + 1}`
  }

  for (const key of rule.matchBy) {
    const attr = rowNode.getAttribute(key)
    if (attr && attr.trim()) {
      return `${key}=${attr.trim()}`
    }

    const direct = [...rowNode.children].find((child) => child.tagName.toLowerCase() === key)
    if (direct?.textContent?.trim()) {
      return `${key}=${direct.textContent.trim()}`
    }
  }

  return `${index + 1}`
}

function groupByCanonicalPath(records: ValueRecord[], mode: CompareMode, rules: RulesConfig) {
  const grouped = new Map<string, ValueRecord[]>()
  records.forEach((record) => {
    const path = canonicalizePath(record.path, mode, rules)
    grouped.set(path, [...(grouped.get(path) ?? []), record])
  })

  return grouped
}

function canonicalizePath(path: string, mode: CompareMode, rules: RulesConfig): string {
  let canonical = path.toLowerCase().replace(/\[.+?\]/g, '')

  if (mode === 'adaptive') {
    for (const [from, to] of Object.entries(rules.nestedPathAliases)) {
      if (canonical.startsWith(from.toLowerCase())) {
        canonical = canonical.replace(from.toLowerCase(), to.toLowerCase())
      }
    }
  }

  if (mode !== 'strict') {
    for (const [from, to] of Object.entries(rules.pathAliases)) {
      const fromLower = from.toLowerCase()
      const toLower = to.toLowerCase()
      if (canonical === fromLower || canonical.endsWith(`.${fromLower}`)) {
        canonical = canonical.replace(fromLower, toLower)
      }
    }
  }

  return canonical
}

function normalizeValue(
  value: string,
  path: string,
  mode: CompareMode,
  rules: RulesConfig,
): NormalizedValue {
  let current = value
  const normalizedBy: string[] = []

  if (rules.normalizers.trimWhitespace) {
    const next = current.trim()
    if (next !== current) normalizedBy.push('trim')
    current = next
  }

  if (rules.normalizers.collapseWhitespace) {
    const next = current.replace(/\s+/g, ' ')
    if (next !== current) normalizedBy.push('collapseWhitespace')
    current = next
  }

  if (mode === 'strict') {
    return { canonical: current, normalizedBy }
  }

  const valueAlias = rules.valueAliases[current]
  if (valueAlias) {
    normalizedBy.push('valueAlias')
    current = valueAlias
  }

  const lowerAlias = rules.valueAliases[current.toLowerCase()]
  if (!valueAlias && lowerAlias) {
    normalizedBy.push('valueAlias')
    current = lowerAlias
  }

  if (rules.normalizers.boolean && /^(true|false)$/i.test(current)) {
    const next = current.toLowerCase()
    if (next !== current) normalizedBy.push('boolean')
    current = next
  }

  if (rules.normalizers.phone && /phone/i.test(path)) {
    const digits = current.replace(/\D/g, '')
    if (digits.length >= 10) {
      const next = digits.slice(-10)
      if (next !== current) normalizedBy.push('phone')
      current = next
    }
  }

  if (rules.normalizers.percent && /%/.test(current)) {
    const numeric = Number(current.replace(/%/g, '').trim())
    if (!Number.isNaN(numeric)) {
      normalizedBy.push('percent')
      current = String(numeric)
    }
  }

  if (rules.normalizers.numeric) {
    const numeric = Number(current)
    if (!Number.isNaN(numeric) && current !== '') {
      const next = String(numeric)
      if (next !== current) normalizedBy.push('numeric')
      current = next
    }
  }

  if (rules.normalizers.date) {
    const dateNormalized = normalizeDate(current)
    if (dateNormalized && dateNormalized !== current) {
      normalizedBy.push('date')
      current = dateNormalized
    }
  }

  return { canonical: current, normalizedBy }
}

function normalizeDate(value: string): string | null {
  if (DATE_ONLY.test(value)) {
    return value
  }

  if (US_DATE_TIME.test(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  return null
}

function findBestMatch(
  soapValue: ValueRecord,
  restValues: ValueRecord[],
  matchedRest: Set<number>,
  mode: CompareMode,
  rules: RulesConfig,
  path: string,
): number {
  const soapNorm = normalizeValue(soapValue.value, path, mode, rules)

  for (let i = 0; i < restValues.length; i += 1) {
    if (matchedRest.has(i)) continue

    const restNorm = normalizeValue(restValues[i].value, path, mode, rules)

    if (mode === 'strict') {
      if (soapNorm.canonical === restNorm.canonical) {
        return i
      }
      continue
    }

    if (soapNorm.canonical === restNorm.canonical) {
      return i
    }

    if (
      rules.emptyZeroRelationship === 'warning' &&
      ((soapNorm.canonical === '' && restNorm.canonical === '0') ||
        (soapNorm.canonical === '0' && restNorm.canonical === ''))
    ) {
      return i
    }
  }

  return -1
}

function buildMatchEntry(
  path: string,
  soapValue: ValueRecord,
  restValue: ValueRecord,
  mode: CompareMode,
  rules: RulesConfig,
): CompareEntry {
  const soapNorm = normalizeValue(soapValue.value, path, mode, rules)
  const restNorm = normalizeValue(restValue.value, path, mode, rules)

  if (mode === 'strict') {
    const exact = soapNorm.canonical === restNorm.canonical
    return {
      severity: exact ? 'info' : 'critical',
      status: exact ? 'exactMatch' : 'valueMismatch',
      canonicalPath: path,
      soapPath: soapValue.path,
      restPath: restValue.path,
      soapValue: soapValue.value,
      restValue: restValue.value,
      note: exact ? 'Exact value/path match (order-independent)' : 'Value mismatch in strict mode',
    }
  }

  if (soapNorm.canonical === restNorm.canonical) {
    const isNormalized = soapValue.value.trim() !== restValue.value.trim()
    const structural =
      canonicalizePath(soapValue.path, mode, rules) === canonicalizePath(restValue.path, mode, rules) &&
      soapValue.path !== restValue.path

    if (structural) {
      return {
        severity: 'warning',
        status: 'structuralMatch',
        canonicalPath: path,
        soapPath: soapValue.path,
        restPath: restValue.path,
        soapValue: soapValue.value,
        restValue: restValue.value,
        note: 'Adaptive structural/path alias match',
      }
    }

    return {
      severity: isNormalized ? 'warning' : 'info',
      status: isNormalized ? 'normalizedMatch' : 'exactMatch',
      canonicalPath: path,
      soapPath: soapValue.path,
      restPath: restValue.path,
      soapValue: soapValue.value,
      restValue: restValue.value,
      note: isNormalized
        ? `Values match after normalization (${[...new Set([...soapNorm.normalizedBy, ...restNorm.normalizedBy])].join(', ') || 'format'})`
        : 'Exact value/path match (order-independent)',
    }
  }

  if (
    rules.emptyZeroRelationship === 'warning' &&
    ((soapNorm.canonical === '' && restNorm.canonical === '0') ||
      (soapNorm.canonical === '0' && restNorm.canonical === ''))
  ) {
    return {
      severity: 'warning',
      status: 'normalizedMatch',
      canonicalPath: path,
      soapPath: soapValue.path,
      restPath: restValue.path,
      soapValue: soapValue.value,
      restValue: restValue.value,
      note: 'Empty vs zero treated as warning-compatible by rule',
    }
  }

  return {
    severity: 'critical',
    status: 'valueMismatch',
    canonicalPath: path,
    soapPath: soapValue.path,
    restPath: restValue.path,
    soapValue: soapValue.value,
    restValue: restValue.value,
    note: 'Business value mismatch after normalization',
  }
}

function buildSummary(entries: CompareEntry[]) {
  const matched = entries.filter((e) => e.status === 'exactMatch').length
  const normalizedWarnings = entries.filter(
    (e) => e.status === 'normalizedMatch' || e.status === 'structuralMatch',
  ).length
  const valueDifferences = entries.filter((e) => e.status === 'valueMismatch').length
  const missingFromCandidate = entries.filter((e) => e.status === 'missingFromCandidate').length
  const extraInCandidate = entries.filter((e) => e.status === 'extraInCandidate').length
  const structuralMatches = entries.filter((e) => e.status === 'structuralMatch').length

  const critical = entries.filter((e) => e.severity === 'critical').length
  const total = entries.length || 1
  const compatibilityScore = Math.max(0, Math.round(((total - critical) / total) * 100))

  return {
    matched,
    normalizedWarnings,
    valueDifferences,
    missingFromCandidate,
    extraInCandidate,
    structuralMatches,
    compatibilityScore,
  }
}

function isIgnoredPath(path: string, ignorePaths: string[]): boolean {
  const lower = path.toLowerCase()
  return ignorePaths.some((ignored) => {
    const i = ignored.toLowerCase().trim()
    return i && (lower === i || lower.startsWith(`${i}.`))
  })
}

export function entriesToCsv(entries: CompareEntry[]): string {
  const pathLevels = entries.map((entry) => pathToLevels(entry.canonicalPath))
  const maxPathDepth = Math.max(1, ...pathLevels.map((levels) => levels.length))
  const header = [
    'severity',
    'status',
    ...Array.from({ length: maxPathDepth }, (_, index) => `pathLevel${index + 1}`),
    'soapPath',
    'restPath',
    'soapValue',
    'restValue',
    'note',
  ]
  const rows = entries.map((entry, index) => {
    const levels = pathLevels[index]
    return [
      entry.severity,
      entry.status,
      ...Array.from({ length: maxPathDepth }, (_, levelIndex) => levels[levelIndex] ?? ''),
      entry.soapPath ?? '',
      entry.restPath ?? '',
      entry.soapValue ?? '',
      entry.restValue ?? '',
      entry.note,
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(',')
  })

  return [header.join(','), ...rows].join('\n')
}

function pathToLevels(path: string): string[] {
  return path.split('.').filter(Boolean)
}

export function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
