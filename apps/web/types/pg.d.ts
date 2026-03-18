declare module "pg" {
  export type QueryResult<Row = Record<string, unknown>> = {
    rowCount: number | null;
    rows: Row[];
  };

  export class PoolClient {
    query<Row = Record<string, unknown>>(
      queryText: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: {
      connectionString?: string;
    });
    query<Row = Record<string, unknown>>(
      queryText: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<Row>>;
    connect(): Promise<PoolClient>;
  }
}
