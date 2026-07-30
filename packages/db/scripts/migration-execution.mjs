const CONCURRENT_INDEX_MARKER = '-- migrate:concurrent-indexes'

export function parseConcurrentIndexMigration(sql) {
  const firstContentLine = sql
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (firstContentLine !== CONCURRENT_INDEX_MARKER) {
    return null
  }

  const executableBody = sql
    .slice(sql.indexOf(CONCURRENT_INDEX_MARKER) + CONCURRENT_INDEX_MARKER.length)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  const indexes = executableBody
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => {
      const match = statement.match(
        /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s+ON\s+[\s\S]+$/i,
      )
      if (!match) {
        throw new Error(
          'Concurrent-index migrations may contain only validated ' +
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS statements.',
        )
      }
      return {
        name: match[1],
        sql: statement,
      }
    })
  if (indexes.length === 0) {
    throw new Error('Concurrent-index migrations must contain an index.')
  }
  if (new Set(indexes.map((index) => index.name)).size !== indexes.length) {
    throw new Error('Concurrent-index migrations must not repeat index names.')
  }
  return indexes
}

export async function executeConcurrentIndexMigration(client, indexes) {
  await client.query("SET lock_timeout = '5s'")
  await client.query("SET statement_timeout = '30min'")
  try {
    for (const index of indexes) {
      const { rows: existingRows } = await client.query(
        `SELECT candidate.indisvalid AS valid
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         JOIN pg_index AS candidate
           ON candidate.indexrelid = relation.oid
         WHERE namespace.nspname = CURRENT_SCHEMA()
           AND relation.relname = $1`,
        [index.name],
      )
      if (existingRows[0]?.valid === false) {
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${index.name}"`)
      }
      await client.query(index.sql)
      const { rows: validityRows } = await client.query(
        `SELECT candidate.indisvalid AS valid
         FROM pg_class AS relation
         JOIN pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         JOIN pg_index AS candidate
           ON candidate.indexrelid = relation.oid
         WHERE namespace.nspname = CURRENT_SCHEMA()
           AND relation.relname = $1`,
        [index.name],
      )
      if (validityRows[0]?.valid !== true) {
        throw new Error(
          `Concurrent index ${index.name} is missing or invalid after build.`,
        )
      }
    }
  } finally {
    await client.query('RESET statement_timeout').catch(() => {})
    await client.query('RESET lock_timeout').catch(() => {})
  }
}

export async function executeMigrationSql(client, sql) {
  const concurrentIndexes = parseConcurrentIndexMigration(sql)
  if (concurrentIndexes) {
    await executeConcurrentIndexMigration(client, concurrentIndexes)
    return
  }
  await client.query(sql)
}
