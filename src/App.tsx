import { useMemo, useState, type ChangeEvent } from 'react'
import './App.css'
import {
  compareXml,
  DEFAULT_RULES,
  downloadText,
  entriesToCsv,
  INVOICE_SAMPLE_REST,
  INVOICE_SAMPLE_SOAP,
  type CompareMode,
  type RulesConfig,
} from './lib/comparer'

const MODE_OPTIONS: CompareMode[] = ['strict', 'normalized', 'adaptive']

function App() {
  const [soapXml, setSoapXml] = useState('')
  const [restXml, setRestXml] = useState('')
  const [mode, setMode] = useState<CompareMode>('adaptive')
  const [rulesText, setRulesText] = useState(JSON.stringify(DEFAULT_RULES, null, 2))
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [error, setError] = useState('')
  const [report, setReport] = useState<ReturnType<typeof compareXml> | null>(null)

  const statuses = useMemo(
    () => ['all', ...(report ? [...new Set(report.entries.map((e) => e.status))] : [])],
    [report],
  )

  const filteredEntries = useMemo(() => {
    if (!report) return []
    return report.entries.filter((entry) => {
      const searchText = search.toLowerCase()
      const textMatches =
        !searchText ||
        [entry.canonicalPath, entry.soapPath, entry.restPath, entry.soapValue, entry.restValue, entry.note]
          .join(' ')
          .toLowerCase()
          .includes(searchText)

      const severityMatches = severityFilter === 'all' || entry.severity === severityFilter
      const statusMatches = statusFilter === 'all' || entry.status === statusFilter

      return textMatches && severityMatches && statusMatches
    })
  }, [report, search, severityFilter, statusFilter])

  const readXmlFile =
    (setter: (value: string) => void) => async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      const text = await file.text()
      setter(text)
    }

  const parseRules = (): RulesConfig | null => {
    try {
      return JSON.parse(rulesText) as RulesConfig
    } catch {
      setError('Rules JSON is invalid. Please fix JSON format.')
      return null
    }
  }

  const onCompare = () => {
    setError('')
    if (!soapXml.trim() || !restXml.trim()) {
      setError('Provide both SOAP and REST XML inputs before comparing.')
      return
    }

    const rules = parseRules()
    if (!rules) return

    try {
      setReport(compareXml(soapXml, restXml, mode, rules))
    } catch (compareError) {
      setReport(null)
      setError(compareError instanceof Error ? compareError.message : 'Failed to compare XML.')
    }
  }

  const onClear = () => {
    setSoapXml('')
    setRestXml('')
    setReport(null)
    setError('')
  }

  const onLoadSample = () => {
    setSoapXml(INVOICE_SAMPLE_SOAP)
    setRestXml(INVOICE_SAMPLE_REST)
    setError('')
  }

  const onExportJson = () => {
    if (!report) return
    downloadText('xml-compare-report.json', JSON.stringify(report, null, 2), 'application/json')
  }

  const onExportCsv = () => {
    if (!report) return
    downloadText('xml-compare-report.csv', entriesToCsv(report.entries), 'text/csv')
  }

  return (
    <main className="app">
      <header>
        <h1>NetSuite SOAP vs REST XML Adaptive Comparer</h1>
        <p>
          Browser-only static tool for compatibility checks. <strong>Privacy:</strong> XML is processed locally in
          your browser and is never uploaded by this app.
        </p>
      </header>

      <section className="actions">
        <div className="modes">
          {MODE_OPTIONS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="mode"
                value={option}
                checked={mode === option}
                onChange={() => setMode(option)}
              />
              {option}
            </label>
          ))}
        </div>
        <button type="button" onClick={onCompare}>
          Compare
        </button>
        <button type="button" onClick={onClear}>
          Clear
        </button>
        <button type="button" onClick={onLoadSample}>
          Load Sample
        </button>
      </section>

      <section className="panels">
        <article>
          <h2>SOAP / Baseline XML</h2>
          <input type="file" accept=".xml,text/xml" onChange={readXmlFile(setSoapXml)} />
          <textarea value={soapXml} onChange={(e) => setSoapXml(e.target.value)} placeholder="Paste SOAP XML" />
        </article>
        <article>
          <h2>REST / Candidate XML</h2>
          <input type="file" accept=".xml,text/xml" onChange={readXmlFile(setRestXml)} />
          <textarea value={restXml} onChange={(e) => setRestXml(e.target.value)} placeholder="Paste REST XML" />
        </article>
      </section>

      <section>
        <h2>Rules Preset: NetSuite SOAP-to-REST Invoice Compatibility</h2>
        <p>Edit aliases, ignore paths, collection matching, nested penetration, and normalizers as JSON.</p>
        <div className="actions">
          <button type="button" onClick={() => setRulesText(JSON.stringify(DEFAULT_RULES, null, 2))}>
            Reset to Default Rules
          </button>
        </div>
        <textarea
          className="rules"
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          aria-label="Rules JSON editor"
        />
      </section>

      {error && <p className="error">{error}</p>}

      {report && (
        <section>
          <h2>Report</h2>
          <div className="summary-grid">
            <div>Matched: {report.summary.matched}</div>
            <div>Normalized/Warnings: {report.summary.normalizedWarnings}</div>
            <div>Value differences: {report.summary.valueDifferences}</div>
            <div>Missing from REST: {report.summary.missingFromCandidate}</div>
            <div>Extra in REST: {report.summary.extraInCandidate}</div>
            <div>Structural/adaptive matches: {report.summary.structuralMatches}</div>
            <div>Compatibility score: {report.summary.compatibilityScore}%</div>
          </div>

          <div className="filters">
            <input
              type="search"
              placeholder="Search path/value/note"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}>
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button type="button" onClick={onExportJson}>
              Export JSON
            </button>
            <button type="button" onClick={onExportCsv}>
              Export CSV
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Canonical Path</th>
                  <th>SOAP Value</th>
                  <th>REST Value</th>
                  <th>SOAP Path</th>
                  <th>REST Path</th>
                  <th>Note/Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry, index) => (
                  <tr key={`${entry.canonicalPath}-${entry.status}-${index}`}>
                    <td>{entry.severity}</td>
                    <td>{entry.status}</td>
                    <td>{entry.canonicalPath}</td>
                    <td>{entry.soapValue ?? ''}</td>
                    <td>{entry.restValue ?? ''}</td>
                    <td>{entry.soapPath ?? ''}</td>
                    <td>{entry.restPath ?? ''}</td>
                    <td>{entry.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}

export default App
