export interface Statement {
  bind(values: any[]): void;
  step(): boolean;
  get(): any[];
  free(): void;
  run(values?: any[]): void;
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
  private results: any[][] = [];
  private currentRow = 0;
  private boundValues: any[] = [];

  constructor(sql: string, mockData: Map<string, any>) {
    this.sql = sql;
    // Simple mock data handling
    if (sql.includes('SELECT * FROM decks')) {
      this.results = mockData.get('decks') || [];
    } else if (sql.includes('SELECT * FROM flashcards')) {
      this.results = mockData.get('flashcards') || [];
    }
  }

  bind(values: any[]): void {
    this.boundValues = values;
    this.currentRow = 0;
  }

  step(): boolean {
    return this.currentRow < this.results.length;
  }

  get(): any[] {
    if (this.currentRow < this.results.length) {
      return this.results[this.currentRow++];
    }
    return [];
  }

  free(): void {
    this.currentRow = 0;
    this.boundValues = [];
  }

  run(values?: any[]): void {
    if (values) {
      this.boundValues = values;
    }
    // Mock execution
  }
}

class MockDatabase implements Database {
  private mockData: Map<string, any> = new Map();
  private exported: Uint8Array = new Uint8Array();

  constructor(data?: Uint8Array) {
    if (data) {
      // Mock loading from data
    }
    // Initialize with empty tables
    this.mockData.set('decks', []);
    this.mockData.set('flashcards', []);
  }

  prepare(sql: string): Statement {
    return new MockStatement(sql, this.mockData);
  }

  run(sql: string): void {
    // Mock running SQL
    console.log('Mock SQL run:', sql);
  }

  export(): Uint8Array {
    return this.exported;
  }

  close(): void {
    // Mock close
  }

  // Test helper methods
  _setMockData(table: string, data: any[]): void {
    this.mockData.set(table, data);
  }

  _getMockData(table: string): any[] {
    return this.mockData.get(table) || [];
  }
}

const mockSqlJs: SqlJsStatic = {
  Database: MockDatabase as any,
};

export default async function initSqlJs(config?: any): Promise<SqlJsStatic> {
  return Promise.resolve(mockSqlJs);
}
