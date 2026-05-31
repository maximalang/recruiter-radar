// Mock implementation of HH adapter functions for testing
const ENV_PARAM_MAP = [
  ['HH_AREA', 'area'],
  ['HH_EMPLOYMENT', 'employment'],
  ['HH_SCHEDULE', 'schedule'],
  ['HH_EXPERIENCE', 'experience'],
  ['HH_PROFESSIONAL_ROLE', 'professional_role'],
  ['HH_INDUSTRY', 'industry'],
  ['HH_DATE_FROM', 'date_from'],
  ['HH_DATE_TO', 'date_to'],
  ['HH_ORDER_BY', 'order_by'],
  ['HH_SEARCH_FIELD', 'search_field'],
]

function parseMultiValue(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function clampInteger(value, defaultValue, minValue, maxValue) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return defaultValue
  return Math.min(maxValue, Math.max(minValue, parsed))
}

function toNonEmptyText(value) {
  if (typeof value !== 'string') return null
  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}

export function resolveHhVacancySearchConfig(env = process.env) {
  const searchText = toNonEmptyText(env.HH_SEARCH_TEXT) ?? 'рекрутер'
  const perPage = clampInteger(env.HH_PER_PAGE, 20, 1, 100)
  const pages = clampInteger(env.HH_PAGES, 1, 1, 20)
  const extraParams = {}

  for (const [envName, paramName] of ENV_PARAM_MAP) {
    const values = parseMultiValue(env[envName])
    if (values.length > 0) {
      extraParams[paramName] = values
    }
  }

  const jsonParams = env.HH_SEARCH_PARAMS_JSON ? JSON.parse(env.HH_SEARCH_PARAMS_JSON) : {}

  for (const [key, value] of Object.entries(jsonParams)) {
    const values = Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : parseMultiValue(value)
    if (values.length > 0) {
      extraParams[key] = values
    }
  }

  return {
    searchText,
    perPage,
    pages,
    extraParams,
  }
}

export async function fetchHhVacancyPages({ userAgent, config = resolveHhVacancySearchConfig() }) {
  const normalizedUserAgent = toNonEmptyText(userAgent)
  if (!normalizedUserAgent) {
    throw new Error('HH user agent is required.')
  }

  // In a real implementation, this would make HTTP requests
  // For testing, we'll simulate the response structure
  const mockResponse = {
    found: 150,
    pages: 3,
    items: [
      {
        id: '123',
        name: 'Вакансия: Senior React Developer',
        employer: { id: 'emp1', name: 'Tech Company', trusted: true },
        area: { id: '1', name: 'Москва' },
        salary: { from: 200000, to: 300000, currency: 'RUB' },
        published_at: '2024-05-28T10:00:00+03:00',
        requirement: 'React, TypeScript, Node.js',
        responsibility: 'Разработка frontend приложений'
      },
      {
        id: '124',
        name: 'Python Developer',
        employer: { id: 'emp2', name: 'Data Corp', trusted: false },
        area: { id: '1', name: 'Москва' },
        salary: { from: 180000, to: 250000, currency: 'RUB' },
        published_at: '2024-05-28T11:00:00+03:00',
        requirement: 'Python, Django, PostgreSQL',
        responsibility: 'Backend разработка'
      }
    ]
  }

  return {
    found: mockResponse.found,
    pagesAvailable: mockResponse.pages,
    pagesFetched: config.pages,
    pageSummaries: Array.from({ length: config.pages }, (_, i) => ({
      page: i,
      items: Math.floor(mockResponse.items.length / config.pages) + (i < mockResponse.items.length % config.pages ? 1 : 0)
    })),
    items: mockResponse.items.slice(0, config.perPage * config.pages),
    config: {
      searchText: config.searchText,
      perPage: config.perPage,
      pages: config.pages,
      extraParams: config.extraParams || {}
    },
  }
}