// Дополнения типов для возможностей Node 24, отсутствующих в установленной версии @types/node.
declare module 'node:sqlite' {
  export class StatementSync {
    run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: any);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
interface ImportMeta { filename: string; dirname: string }
