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
  const sortedSoapXml = serializeSortedXml(soapRoot)
  const sortedRestXml = serializeSortedXml(restRoot)

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

  const sortedChildren = childElements.sort((a, b) => {
    const tagCompare = a.tagName.localeCompare(b.tagName)
    if (tagCompare !== 0) return tagCompare
    return sortableElementText(a).localeCompare(sortableElementText(b))
  })
  const children = sortedChildren.map((child) => serializeElement(child, depth + 1)).join('\n')

  return `${indent}${openTag}\n${children}\n${indent}</${element.tagName}>`
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
  const maxLines = Math.max(soapLines.length, restLines.length)

  return {
    soapLines: Array.from({ length: maxLines }, (_, index) => ({
      lineNumber: index + 1,
      text: soapLines[index] ?? '',
      different: (soapLines[index] ?? '') !== (restLines[index] ?? ''),
    })),
    restLines: Array.from({ length: maxLines }, (_, index) => ({
      lineNumber: index + 1,
      text: restLines[index] ?? '',
      different: (soapLines[index] ?? '') !== (restLines[index] ?? ''),
    })),
  }
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
  const header = [
    'severity',
    'status',
    'canonicalPath',
    'soapPath',
    'restPath',
    'soapValue',
    'restValue',
    'note',
  ]
  const rows = entries.map((entry) =>
    [
      entry.severity,
      entry.status,
      entry.canonicalPath,
      entry.soapPath ?? '',
      entry.restPath ?? '',
      entry.soapValue ?? '',
      entry.restValue ?? '',
      entry.note,
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(','),
  )

  return [header.join(','), ...rows].join('\n')
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
