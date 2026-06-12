import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { xml } from '@codemirror/lang-xml'
import { openSearchPanel } from '@codemirror/search'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import './App.css'
import {
  compareXml,
  DEFAULT_RULES,
  downloadText,
  entriesToCsv,
  INVOICE_SAMPLE_REST,
  INVOICE_SAMPLE_SOAP,
  reportToHtml,
  type CompareMode,
  type XmlDiffLine,
} from './lib/comparer'

const MODE_OPTIONS: CompareMode[] = ['strict', 'normalized', 'adaptive']

function App() {
  const [soapXml, setSoapXml] = useState('')
  const [restXml, setRestXml] = useState('')
  const [mode, setMode] = useState<CompareMode>('adaptive')
  const [error, setError] = useState('')
  const [report, setReport] = useState<ReturnType<typeof compareXml> | null>(null)
  const xmlExtensions = useMemo(() => [xml()], [])
  const soapEditorRef = useRef<EditorView | null>(null)
  const restEditorRef = useRef<EditorView | null>(null)
  const isSyncingScrollRef = useRef(false)

  const syncXmlScroll = useCallback((source: 'soap' | 'rest') => {
    return (sourceEditor: EditorView) => {
      if (isSyncingScrollRef.current) return

      const targetEditor = source === 'soap' ? restEditorRef.current : soapEditorRef.current
      if (!targetEditor) return

      const sourceScroller = sourceEditor.scrollDOM
      const targetScroller = targetEditor.scrollDOM
      const sourceScrollableHeight = sourceScroller.scrollHeight - sourceScroller.clientHeight
      const targetScrollableHeight = targetScroller.scrollHeight - targetScroller.clientHeight
      const scrollRatio = sourceScrollableHeight > 0 ? sourceScroller.scrollTop / sourceScrollableHeight : 0

      isSyncingScrollRef.current = true
      targetScroller.scrollTop = scrollRatio * targetScrollableHeight
      targetScroller.scrollLeft = sourceScroller.scrollLeft
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    }
  }, [])

  const readXmlFile =
    (setter: (value: string) => void) => async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      const text = await file.text()
      setter(text)
    }

  const onCompare = () => {
    setError('')
    if (!soapXml.trim() || !restXml.trim()) {
      setError('Provide both SOAP and REST XML inputs before comparing.')
      return
    }

    try {
      setReport(compareXml(soapXml, restXml, mode, DEFAULT_RULES))
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

  const onExportHtml = () => {
    if (!report) return
    downloadText('xml-compare-report.html', reportToHtml(report), 'text/html')
  }

  return (
    <main className="app">
      <header>
        <h1>NetSuite SOAP vs REST XML Adaptive Comparer</h1>
        <p>
          Browser-only static tool for similarity checks. <strong>Privacy:</strong> XML is processed locally in your
          browser and is never uploaded by this app.
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
            <button type="button" onClick={onExportHtml}>
              Export HTML
            </button>
            <button type="button" onClick={onExportJson}>
              Export JSON
            </button>
            <button type="button" onClick={onExportCsv}>
              Export CSV
            </button>
          </div>

          <h3>Sorted XML Difference View</h3>
          <p className="muted">
            Each XML tree is shown from its detected business root, with attributes and same-level child nodes sorted
            alphabetically before comparison. Blank lines align same-level nodes where one side has extra content.
          </p>
          <HighlightLegend />
          <div className="xml-diff-grid">
            <XmlViewer
              title="SOAP / Baseline sorted XML"
              lines={report.sortedXml.soapLines}
              extensions={xmlExtensions}
              onCreateEditor={(view) => {
                soapEditorRef.current = view
              }}
              onScrollSync={syncXmlScroll('soap')}
            />
            <XmlViewer
              title="REST / Candidate sorted XML"
              lines={report.sortedXml.restLines}
              extensions={xmlExtensions}
              onCreateEditor={(view) => {
                restEditorRef.current = view
              }}
              onScrollSync={syncXmlScroll('rest')}
            />
          </div>

        </section>
      )}
    </main>
  )
}

function HighlightLegend() {
  return (
    <div className="highlight-legend" aria-label="Highlight legend">
      <span className="legend-critical">REST differs from SOAP or SOAP line is missing</span>
      <span className="legend-warning">Same node name with different case only</span>
      <span className="legend-success">REST-only extra line</span>
    </div>
  )
}

function XmlViewer({
  title,
  lines,
  extensions,
  onCreateEditor,
  onScrollSync,
}: {
  title: string
  lines: XmlDiffLine[]
  extensions: ReturnType<typeof xml>[]
  onCreateEditor: (view: EditorView) => void
  onScrollSync: (view: EditorView) => void
}) {
  const editorRef = useRef<EditorView | null>(null)
  const changedLines = lines.filter((line) => line.different).map((line) => line.lineNumber)
  const viewerValue = useMemo(() => lines.map((line) => line.text).join('\n'), [lines])
  const viewerExtensions = useMemo(
    () => [
      ...extensions,
      xmlLineHighlightExtension(lines),
      EditorView.domEventHandlers({
        scroll: (_event, view) => {
          onScrollSync(view)
        },
      }),
    ],
    [extensions, lines, onScrollSync],
  )

  const onSearch = () => {
    if (!editorRef.current) return
    editorRef.current.focus()
    openSearchPanel(editorRef.current)
  }

  return (
    <article className="xml-viewer">
      <div className="xml-viewer-heading">
        <h4>{title}</h4>
        <div className="xml-viewer-actions">
          <button type="button" onClick={onSearch}>
            Search
          </button>
          <span>{changedLines.length} changed lines</span>
        </div>
      </div>
      <CodeMirror
        value={viewerValue}
        height="420px"
        extensions={viewerExtensions}
        basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: false, searchKeymap: true }}
        editable={false}
        readOnly
        theme="light"
        onCreateEditor={(view) => {
          editorRef.current = view
          onCreateEditor(view)
        }}
      />
      {changedLines.length > 0 && (
        <p className="changed-lines">Changed lines: {changedLines.slice(0, 60).join(', ')}</p>
      )}
    </article>
  )
}

function xmlLineHighlightExtension(lines: XmlDiffLine[]) {
  const lineClasses = new Map(
    lines
      .filter((line) => line.highlight)
      .map((line) => [line.lineNumber, `cm-diff-${line.highlight}`]),
  )
  const caseDiffRanges = new Map(
    lines
      .filter((line) => line.caseDiffRanges?.length)
      .map((line) => [line.lineNumber, line.caseDiffRanges ?? []]),
  )

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildLineDecorations(view, lineClasses, caseDiffRanges)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildLineDecorations(update.view, lineClasses, caseDiffRanges)
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  )
}

function buildLineDecorations(
  view: EditorView,
  lineClasses: Map<number, string>,
  caseDiffRanges: Map<number, NonNullable<XmlDiffLine['caseDiffRanges']>>,
): DecorationSet {
  const lineDecorations = [...lineClasses.entries()]
    .filter(([lineNumber]) => lineNumber <= view.state.doc.lines)
    .map(([lineNumber, className]) => Decoration.line({ class: className }).range(view.state.doc.line(lineNumber).from))

  const characterDecorations = [...caseDiffRanges.entries()].flatMap(([lineNumber, ranges]) => {
    if (lineNumber > view.state.doc.lines) return []

    const line = view.state.doc.line(lineNumber)
    return ranges.map((range) =>
      Decoration.mark({ class: 'cm-diff-case-char' }).range(line.from + range.from, line.from + range.to),
    )
  })

  return Decoration.set([...lineDecorations, ...characterDecorations], true)
}

export default App
