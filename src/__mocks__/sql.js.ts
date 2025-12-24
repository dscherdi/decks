import { SqlJsValue } from "../database/sql-types";

export interface Statement {
  bind(values: SqlJsValue[]): void;
  step(): boolean;
  get(): SqlJsValue[];
  free(): void;
  run(values?: SqlJsValue[]): void;
}

export interface Database {
  prepare(sql: string): Statement;
  run(sql: string): void;
  export(): Uint8Array;
  close(): void;
}

export interface SqlJsStatic {
  Database: new (data?: Uint8Array) => Database;
}

class MockStatement implements Statement {
  private sql: string;
  private results: SqlJsValue[][] = [];
  private currentRow = 0;
  private boundValues: SqlJsValue[] = [];

  constructor(sql: string, mockData: Map<string, SqlJsValue[]>) {
    this.sql = sql;
    // Simple mock data handling
    if (sql.includes("SELECT * FROM decks")) {
      this.results = mockData.get("decks") || [];
    } else if (sql.includes("SELECT * FROM flashcards")) {
      this.results = mockData.get("flashcards") || [];
    }
  }

  bind(values: SqlJsValue[]): void {
    this.boundValues = values;
    this.currentRow = 0;
  }

  step(): boolean {
    return this.currentRow < this.results.length;
  }

  get(): SqlJsValue[] {
    if (this.currentRow < this.results.length) {
      return this.results[this.currentRow++];
    }
    return [];
  }

  free(): void {
    this.currentRow = 0;
    this.boundValues = [];
  }

  run(values?: SqlJsValue[]): void {
    if (values) {
      this.boundValues = values;
    }
    // Mock execution
  }
}

class MockDatabase implements Database {
  private mockData: Map<string, SqlJsValue[]> = new Map();
  private exported: Uint8Array = new Uint8Array();

  constructor(data?: Uint8Array) {
    if (data) {
      // Mock loading from data
    }
    // Initialize with empty tables
    this.mockData.set("decks", []);
    this.mockData.set("flashcards", []);
  }

  prepare(sql: string): Statement {
    return new MockStatement(sql, this.mockData);
  }

  run(sql: string): void {
    // Mock running SQL
    console.log("Mock SQL run:", sql);
  }

  export(): Uint8Array {
    return this.exported;
  }

  close(): void {
    // Mock close
  }

  // Test helper methods
  _setMockData(table: string, data: SqlJsValue[]): void {
    this.mockData.set(table, data);
  }

  _getMockData(table: string): SqlJsValue[] {
    return this.mockData.get(table) || [];
  }
}

const mockSqlJs: SqlJsStatic = {
  Database: MockDatabase as any,
};

export default async function initSqlJs(
  config?: SqlJsValue,
): Promise<SqlJsStatic> {
  return Promise.resolve(mockSqlJs);
}
