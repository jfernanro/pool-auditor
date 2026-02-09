import React, { useState, useCallback, useMemo } from 'react'
import { Upload, AlertTriangle, CheckCircle, XCircle, Download, FileCode, Database, Settings, ChevronDown, ChevronUp, Info } from 'lucide-react'

const FACTORY_PLUS = 'com.indra.jdbc.pool.EncryptedDataSourceFactoryPlus'

const MANDATORY_PARAMS = {
  factory: FACTORY_PLUS,
  removeAbandoned: 'true',
  removeAbandonedTimeout: '3600',
  validationInterval: '30000',
  testOnBorrow: 'true',
  testWhileIdle: 'true',
  timeBetweenEvictionRunsMillis: '30000',
  minEvictableIdleTimeMillis: '60000',
  logAbandoned: 'true'
}

const PARAM_DESCRIPTIONS = {
  factory: 'Upgrade a libreria jdbc-pool encriptada',
  removeAbandoned: 'Prevencion de fugas de conexiones',
  removeAbandonedTimeout: 'Timeout para procesos largos (1h)',
  validationInterval: 'Intervalo de validacion (30s)',
  testOnBorrow: 'Validar conexion antes de uso',
  testWhileIdle: 'Validar conexiones inactivas',
  timeBetweenEvictionRunsMillis: 'Ciclo de limpieza del pool',
  minEvictableIdleTimeMillis: 'Tiempo minimo para eviccion',
  logAbandoned: 'Log de conexiones abandonadas',
  maxActive: 'Conexiones activas maximas',
  maxTotal: 'Conexiones totales maximas',
  maxIdle: 'Conexiones inactivas maximas',
  minIdle: 'Conexiones inactivas minimas',
  initialSize: 'Conexiones iniciales'
}

function parseXML(xmlString) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'text/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('XML mal formado: ' + parseError.textContent)
  }
  return doc
}

function extractResources(doc) {
  const resources = []
  const resourceNodes = doc.querySelectorAll('Resource')
  
  resourceNodes.forEach((node, index) => {
    const attrs = {}
    for (const attr of node.attributes) {
      attrs[attr.name] = attr.value
    }
    if (attrs.type && attrs.type.includes('DataSource')) {
      resources.push({
        id: index,
        name: attrs.name || `Resource_${index}`,
        type: attrs.type || '',
        attributes: attrs,
        node: node
      })
    }
  })
  
  return resources
}

function auditResource(resource) {
  const attrs = resource.attributes
  const issues = []
  const suggestions = {}
  
  const maxActive = parseInt(attrs.maxActive || attrs.maxTotal || '0', 10)
  
  if (maxActive <= 1) {
    issues.push({
      level: 'critical',
      param: 'maxActive',
      message: `Pool con M=${maxActive} es critico. Riesgo de bloqueo total.`,
      original: maxActive.toString()
    })
    suggestions.maxActive = '50'
  } else if (maxActive < 10) {
    issues.push({
      level: 'warning',
      param: 'maxActive',
      message: `Pool con M=${maxActive} es bajo para PRO. Sugerido: 50`,
      original: maxActive.toString()
    })
    suggestions.maxActive = '50'
  }
  
  const M = parseInt(suggestions.maxActive || attrs.maxActive || attrs.maxTotal || '50', 10)
  const calculatedInitial = Math.max(1, Math.floor(M * 0.1))
  
  if (attrs.maxIdle !== String(M)) {
    issues.push({
      level: 'warning',
      param: 'maxIdle',
      message: `maxIdle debe ser igual a M (${M})`,
      original: attrs.maxIdle || 'no definido'
    })
    suggestions.maxIdle = String(M)
  }
  
  if (attrs.initialSize !== String(calculatedInitial)) {
    issues.push({
      level: 'info',
      param: 'initialSize',
      message: `initialSize sugerido: max(1, floor(M*0.1)) = ${calculatedInitial}`,
      original: attrs.initialSize || 'no definido'
    })
    suggestions.initialSize = String(calculatedInitial)
  }
  
  if (attrs.minIdle !== String(calculatedInitial)) {
    issues.push({
      level: 'info',
      param: 'minIdle',
      message: `minIdle debe ser igual a initialSize (${calculatedInitial})`,
      original: attrs.minIdle || 'no definido'
    })
    suggestions.minIdle = String(calculatedInitial)
  }
  
  for (const [param, value] of Object.entries(MANDATORY_PARAMS)) {
    if (attrs[param] !== value) {
      const level = param === 'factory' ? 'critical' : 'warning'
      issues.push({
        level,
        param,
        message: PARAM_DESCRIPTIONS[param],
        original: attrs[param] || 'no definido'
      })
      suggestions[param] = value
    }
  }
  
  return { issues, suggestions }
}

function generateNewXML(originalXML, resources, allSuggestions) {
  let newXML = originalXML
  
  resources.forEach((resource) => {
    const suggestions = allSuggestions[resource.id] || {}
    if (Object.keys(suggestions).length === 0) return
    
    const nameAttr = resource.attributes.name
    const escapedName = nameAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    
    const resourceRegex = new RegExp(
      `(<Resource[^>]*name\\s*=\\s*["']${escapedName}["'][^/]*)(\\s*/?>)`,
      's'
    )
    
    newXML = newXML.replace(resourceRegex, (match, start, end) => {
      let modified = start
      
      for (const [param, value] of Object.entries(suggestions)) {
        const paramRegex = new RegExp(`(\\s+)${param}\\s*=\\s*["'][^"']*["']`, 'g')
        if (paramRegex.test(modified)) {
          modified = modified.replace(
            new RegExp(`(\\s+)${param}\\s*=\\s*["'][^"']*["']`, 'g'),
            `$1${param}="${value}"`
          )
        } else {
          modified = modified + `\n               ${param}="${value}"`
        }
      }
      
      return modified + end
    })
  })
  
  return newXML
}

function IssueIcon({ level }) {
  switch (level) {
    case 'critical':
      return <XCircle className="w-4 h-4 text-red-400" />
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-amber-400" />
    default:
      return <Info className="w-4 h-4 text-sky-400" />
  }
}

function ResourceCard({ resource, audit, expanded, onToggle }) {
  const { issues, suggestions } = audit
  
  const criticalCount = issues.filter(i => i.level === 'critical').length
  const warningCount = issues.filter(i => i.level === 'warning').length
  const infoCount = issues.filter(i => i.level === 'info').length
  
  let borderColor = 'border-emerald-500/50'
  let bgGlow = ''
  if (criticalCount > 0) {
    borderColor = 'border-red-500/70'
    bgGlow = 'shadow-red-500/10'
  } else if (warningCount > 0) {
    borderColor = 'border-amber-500/50'
    bgGlow = 'shadow-amber-500/10'
  }
  
  return (
    <div className={`bg-slate-800/80 backdrop-blur border ${borderColor} rounded-lg overflow-hidden shadow-lg ${bgGlow}`}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-slate-400" />
          <div className="text-left">
            <span className="text-slate-100 font-mono text-sm">{resource.name}</span>
            <div className="flex gap-3 mt-1 text-xs">
              {criticalCount > 0 && (
                <span className="text-red-400">{criticalCount} critico</span>
              )}
              {warningCount > 0 && (
                <span className="text-amber-400">{warningCount} warning</span>
              )}
              {infoCount > 0 && (
                <span className="text-sky-400">{infoCount} info</span>
              )}
              {issues.length === 0 && (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> OK
                </span>
              )}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-slate-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-500" />
        )}
      </button>
      
      {expanded && issues.length > 0 && (
        <div className="px-4 pb-4 space-y-2">
          <div className="border-t border-slate-700 pt-3">
            {issues.map((issue, idx) => (
              <div key={idx} className="flex items-start gap-2 py-2 border-b border-slate-700/50 last:border-0">
                <IssueIcon level={issue.level} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-slate-900 px-1.5 py-0.5 rounded text-slate-300">
                      {issue.param}
                    </code>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{issue.message}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <span className="text-slate-500">Original:</span>
                    <code className="text-red-400 bg-red-950/30 px-1.5 py-0.5 rounded">
                      {issue.original}
                    </code>
                    <span className="text-slate-600">-&gt;</span>
                    <span className="text-slate-500">Nuevo:</span>
                    <code className="text-emerald-400 bg-emerald-950/30 px-1.5 py-0.5 rounded">
                      {suggestions[issue.param]}
                    </code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DropZone({ onFileLoad, hasFile }) {
  const [dragOver, setDragOver] = useState(false)
  
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    
    const file = e.dataTransfer?.files[0] || e.target?.files?.[0]
    if (!file) return
    
    if (!file.name.endsWith('.xml')) {
      alert('Solo se permiten archivos .xml')
      return
    }
    
    const reader = new FileReader()
    reader.onload = (event) => {
      onFileLoad(event.target.result, file.name)
    }
    reader.readAsText(file, 'ISO-8859-1')
  }, [onFileLoad])
  
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`
        relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
        ${dragOver 
          ? 'border-cyan-400 bg-cyan-950/20' 
          : hasFile 
            ? 'border-emerald-500/50 bg-emerald-950/10' 
            : 'border-slate-600 hover:border-slate-500 bg-slate-800/30'
        }
      `}
    >
      <input
        type="file"
        accept=".xml"
        onChange={handleDrop}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
      <Upload className={`w-10 h-10 mx-auto mb-3 ${dragOver ? 'text-cyan-400' : 'text-slate-500'}`} />
      <p className="text-slate-300 font-medium">
        {hasFile ? 'Cargar otro archivo' : 'Arrastra tu context.xml aqui'}
      </p>
      <p className="text-slate-500 text-sm mt-1">o haz clic para seleccionar</p>
    </div>
  )
}

function SummaryStats({ resources, audits }) {
  const totals = useMemo(() => {
    let critical = 0, warning = 0, info = 0, ok = 0
    
    Object.values(audits).forEach(audit => {
      const c = audit.issues.filter(i => i.level === 'critical').length
      const w = audit.issues.filter(i => i.level === 'warning').length
      const i = audit.issues.filter(i => i.level === 'info').length
      
      critical += c
      warning += w
      info += i
      if (c === 0 && w === 0 && i === 0) ok++
    })
    
    return { critical, warning, info, ok, total: resources.length }
  }, [resources, audits])
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div className="bg-slate-800/60 rounded-lg p-3 text-center border border-slate-700">
        <div className="text-2xl font-bold text-slate-100">{totals.total}</div>
        <div className="text-xs text-slate-500 uppercase tracking-wide">Resources</div>
      </div>
      <div className="bg-red-950/30 rounded-lg p-3 text-center border border-red-900/50">
        <div className="text-2xl font-bold text-red-400">{totals.critical}</div>
        <div className="text-xs text-red-400/70 uppercase tracking-wide">Criticos</div>
      </div>
      <div className="bg-amber-950/30 rounded-lg p-3 text-center border border-amber-900/50">
        <div className="text-2xl font-bold text-amber-400">{totals.warning}</div>
        <div className="text-xs text-amber-400/70 uppercase tracking-wide">Warnings</div>
      </div>
      <div className="bg-sky-950/30 rounded-lg p-3 text-center border border-sky-900/50">
        <div className="text-2xl font-bold text-sky-400">{totals.info}</div>
        <div className="text-xs text-sky-400/70 uppercase tracking-wide">Info</div>
      </div>
      <div className="bg-emerald-950/30 rounded-lg p-3 text-center border border-emerald-900/50">
        <div className="text-2xl font-bold text-emerald-400">{totals.ok}</div>
        <div className="text-xs text-emerald-400/70 uppercase tracking-wide">OK</div>
      </div>
    </div>
  )
}

export default function App() {
  const [originalXML, setOriginalXML] = useState('')
  const [fileName, setFileName] = useState('')
  const [resources, setResources] = useState([])
  const [audits, setAudits] = useState({})
  const [expandedCards, setExpandedCards] = useState({})
  const [error, setError] = useState('')
  
  const handleFileLoad = useCallback((content, name) => {
    setError('')
    setOriginalXML(content)
    setFileName(name)
    
    try {
      const doc = parseXML(content)
      const extractedResources = extractResources(doc)
      
      if (extractedResources.length === 0) {
        setError('No se encontraron elementos Resource de tipo DataSource')
        return
      }
      
      setResources(extractedResources)
      
      const newAudits = {}
      const newExpanded = {}
      extractedResources.forEach(resource => {
        newAudits[resource.id] = auditResource(resource)
        newExpanded[resource.id] = newAudits[resource.id].issues.length > 0
      })
      
      setAudits(newAudits)
      setExpandedCards(newExpanded)
    } catch (err) {
      setError(err.message)
    }
  }, [])
  
  const handleDownload = useCallback(() => {
    const suggestions = {}
    Object.entries(audits).forEach(([id, audit]) => {
      suggestions[id] = audit.suggestions
    })
    
    const newXML = generateNewXML(originalXML, resources, suggestions)
    
    const blob = new Blob([newXML], { type: 'application/xml;charset=ISO-8859-1' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.replace('.xml', '.NEW.xml')
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [originalXML, resources, audits, fileName])
  
  const toggleCard = useCallback((id) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])
  
  const hasIssues = Object.values(audits).some(a => a.issues.length > 0)
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/10 via-transparent to-transparent pointer-events-none" />
      
      <div className="relative max-w-5xl mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Settings className="w-8 h-8 text-cyan-400" />
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
              JDBC Pool Auditor
            </h1>
          </div>
          <p className="text-slate-400 text-sm">
            Auditoria y migracion a EncryptedDataSourceFactoryPlus
          </p>
        </header>
        
        <div className="space-y-6">
          <DropZone onFileLoad={handleFileLoad} hasFile={!!originalXML} />
          
          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 flex items-center gap-3">
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
          
          {resources.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-slate-500" />
                  <span className="text-slate-300 font-mono text-sm">{fileName}</span>
                </div>
              </div>
              
              <SummaryStats resources={resources} audits={audits} />
              
              <div className="space-y-3">
                {resources.map(resource => (
                  <ResourceCard
                    key={resource.id}
                    resource={resource}
                    audit={audits[resource.id] || { issues: [], suggestions: {} }}
                    expanded={expandedCards[resource.id]}
                    onToggle={() => toggleCard(resource.id)}
                  />
                ))}
              </div>
              
              {hasIssues && (
                <div className="fixed bottom-6 right-6">
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white px-5 py-3 rounded-full shadow-lg shadow-cyan-500/25 transition-all hover:shadow-cyan-500/40 font-medium"
                  >
                    <Download className="w-5 h-5" />
                    Descargar .NEW
                  </button>
                </div>
              )}
            </>
          )}
          
          {!originalXML && (
            <div className="bg-slate-800/40 rounded-xl p-6 border border-slate-700/50">
              <h2 className="text-slate-200 font-medium mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-cyan-400" />
                Reglas de auditoria aplicadas
              </h2>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <h3 className="text-slate-400 uppercase text-xs tracking-wide">Dimensionamiento</h3>
                  <ul className="space-y-1 text-slate-500">
                    <li>- maxActive &lt;= 1 = Critico</li>
                    <li>- maxActive &lt; 10 = Warning (PRO: 50)</li>
                    <li>- maxIdle = maxActive</li>
                    <li>- initialSize = max(1, floor(M*0.1))</li>
                    <li>- minIdle = initialSize</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <h3 className="text-slate-400 uppercase text-xs tracking-wide">Factory Plus</h3>
                  <ul className="space-y-1 text-slate-500">
                    <li>- factory = EncryptedDataSourceFactoryPlus</li>
                    <li>- removeAbandoned = true</li>
                    <li>- removeAbandonedTimeout = 3600</li>
                    <li>- validationInterval = 30000</li>
                    <li>- testOnBorrow = true</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <footer className="mt-12 text-center text-slate-600 text-xs">
          Procesamiento 100% local - Sin envio de datos a servidores externos
        </footer>
      </div>
    </div>
  )
}
