import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const up = fs.readFileSync(path.join(root, 'packages/db/migrations/20260814040000_add_canonical_vacancy_lifecycle.sql'), 'utf8')
const down = fs.readFileSync(path.join(root, 'packages/db/migrations/20260814040000_add_canonical_vacancy_lifecycle.down.sql'), 'utf8')

test('adds auditable canonical vacancy lifecycle storage', () => {
  for (const table of [
    'canonical_vacancies_v1',
    'canonical_vacancy_publications_v1',
    'canonical_vacancy_observations_v1',
    'canonical_vacancy_events_v1',
  ]) expect(up).toContain(`CREATE TABLE ${table}`)

  for (const field of [
    'first_seen_at',
    'last_seen_at',
    'last_source_seen_at',
    'closed_at',
    'reopened_at',
    'source_families',
    'source_external_ids',
    'successful_absence_observation_ids',
  ]) expect(up).toContain(field)

  expect(up).toContain("event_type IN ('opened', 'closed', 'reopened')")
  expect(up).not.toMatch(/DELETE\s+FROM|TRUNCATE|UPDATE\s+(signals|hiring_episodes|opportunities)/i)
})

test('drops lifecycle tables in dependency order', () => {
  expect(down.indexOf('canonical_vacancy_events_v1')).toBeLessThan(
    down.indexOf('canonical_vacancy_observations_v1'),
  )
  expect(down.indexOf('canonical_vacancy_observations_v1')).toBeLessThan(
    down.indexOf('canonical_vacancies_v1'),
  )
})
