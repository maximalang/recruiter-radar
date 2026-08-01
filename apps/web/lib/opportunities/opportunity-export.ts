import { strToU8, zipSync } from 'fflate'

export interface OpportunityExportRecord {
  opportunityReference: string
  organizationName: string
  organizationDomain: string | null
  title: string
  commercialStage: string
  workflowState: string
  whyNow: string
  problemHypothesis: string
  recommendedAngle: string
  recommendedPersona: string
  recommendedAction: string
  opportunityScore: number
  confidenceGate: string
  validUntil: string | null
  nextActionType: string | null
  nextActionDueAt: string | null
  workflowPriority: string | null
  evidenceUrls: string[]
}

export interface OpportunityExportSource {
  publicReference: string
  organizationName: string
  organizationDomain: string | null
  title: string
  commercialStage: string
  workflowState: string
  whyNow: string
  problemHypothesis: string
  recommendedAngle: string
  recommendedPersona: string
  recommendedAction: string
  opportunityScore: number
  confidenceGate: string
  validUntil: string | null
  workflow: {
    nextActionType: string | null
    nextActionDueAt: string | null
    workflowPriority: string | null
  } | null
  evidenceTimeline: readonly { url: string | null }[]
}

const COLUMNS = [
  'opportunityReference',
  'organizationName',
  'organizationDomain',
  'title',
  'commercialStage',
  'workflowState',
  'whyNow',
  'problemHypothesis',
  'recommendedAngle',
  'recommendedPersona',
  'recommendedAction',
  'opportunityScore',
  'confidenceGate',
  'validUntil',
  'nextActionType',
  'nextActionDueAt',
  'workflowPriority',
  'evidenceUrls',
] as const satisfies readonly (keyof OpportunityExportRecord)[]

type ExportColumn = (typeof COLUMNS)[number]

export function toOpportunityExportRecord<T extends OpportunityExportSource>(
  opportunity: T,
): OpportunityExportRecord {
  return {
    opportunityReference: opportunity.publicReference,
    organizationName: opportunity.organizationName,
    organizationDomain: opportunity.organizationDomain,
    title: opportunity.title,
    commercialStage: opportunity.commercialStage,
    workflowState: opportunity.workflowState,
    whyNow: opportunity.whyNow,
    problemHypothesis: opportunity.problemHypothesis,
    recommendedAngle: opportunity.recommendedAngle,
    recommendedPersona: opportunity.recommendedPersona,
    recommendedAction: opportunity.recommendedAction,
    opportunityScore: opportunity.opportunityScore,
    confidenceGate: opportunity.confidenceGate,
    validUntil: opportunity.validUntil,
    nextActionType: opportunity.workflow?.nextActionType ?? null,
    nextActionDueAt: opportunity.workflow?.nextActionDueAt ?? null,
    workflowPriority: opportunity.workflow?.workflowPriority ?? null,
    evidenceUrls: [...new Set(opportunity.evidenceTimeline
      .map((evidence) => evidence.url)
      .filter((url): url is string => Boolean(url)))],
  }
}

export function opportunitiesToCsv(
  records: readonly OpportunityExportRecord[],
): string {
  const lines = [
    COLUMNS.join(','),
    ...records.map((record) => COLUMNS
      .map((column) => csvCell(exportValue(record, column)))
      .join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function opportunitiesToXlsx(
  records: readonly OpportunityExportRecord[],
): Uint8Array {
  const rows = [
    [...COLUMNS],
    ...records.map((record) => COLUMNS.map((column) =>
      exportValue(record, column),
    )),
  ]
  const worksheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) =>
      inlineStringCell(columnIndex, rowIndex, value),
    ).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  const worksheet = xml(`
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${worksheetRows}</sheetData>
    </worksheet>`)
  const archiveTime = new Date('1980-01-01T00:00:00.000Z')
  const entry = (
    value: string,
  ): [Uint8Array, { level: 6; mtime: Date }] => [
    strToU8(value),
    { level: 6, mtime: archiveTime },
  ]

  return zipSync({
    '[Content_Types].xml': entry(CONTENT_TYPES),
    '_rels/.rels': entry(PACKAGE_RELS),
    'xl/workbook.xml': entry(WORKBOOK),
    'xl/_rels/workbook.xml.rels': entry(WORKBOOK_RELS),
    'xl/styles.xml': entry(STYLES),
    'xl/worksheets/sheet1.xml': entry(worksheet),
  })
}

function exportValue(
  record: OpportunityExportRecord,
  column: ExportColumn,
): string {
  const value = record[column]
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '')
  return neutralizeSpreadsheetFormula(text)
}

function neutralizeSpreadsheetFormula(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function inlineStringCell(
  columnIndex: number,
  rowIndex: number,
  value: string,
): string {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${
    escapeXml(value)
  }</t></is></c>`
}

function columnName(index: number): string {
  let current = index + 1
  let name = ''
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`
}

const CONTENT_TYPES = xml(`
  <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  </Types>`)

const PACKAGE_RELS = xml(`
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  </Relationships>`)

const WORKBOOK = xml(`
  <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheets><sheet name="Opportunity export" sheetId="1" r:id="rId1"/></sheets>
  </workbook>`)

const WORKBOOK_RELS = xml(`
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  </Relationships>`)

const STYLES = xml(`
  <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
    <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
    <borders count="1"><border/></borders>
    <cellStyleXfs count="1"><xf/></cellStyleXfs>
    <cellXfs count="1"><xf xfId="0"/></cellXfs>
  </styleSheet>`)
