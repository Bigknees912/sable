const { randomUUID } = require("node:crypto");

// A minimal in-memory stand-in for the slice of the supabase-js
// query-builder API this codebase actually uses (.from/.select/.insert/
// .update/.eq/.neq/.in/.single/.maybeSingle). Not a general-purpose mock -
// just enough to exercise createBooking/nextAvailableSlots's real
// branching logic in a test without a live database. See booking.js's
// comment on why these functions accept an injectable client.

class FakeQueryBuilder {
  constructor(table, op, payload, tableName) {
    this.table = table; // { rows: [...] }
    this.op = op; // 'select' | 'insert' | 'update'
    this.payload = payload;
    this.tableName = tableName;
    this.filters = [];
    this._selectCalled = false;
    this._single = false;
    this._maybeSingle = false;
  }

  eq(col, val) {
    this.filters.push({ type: "eq", col, val });
    return this;
  }
  neq(col, val) {
    this.filters.push({ type: "neq", col, val });
    return this;
  }
  gte(col, val) {
    this.filters.push({ type: "gte", col, val });
    return this;
  }
  in(col, vals) {
    this.filters.push({ type: "in", col, val: vals });
    return this;
  }
  // Supports the subset used in booking.js: "col.eq.val,col2.eq.val2"
  // meaning (col = val) OR (col2 = val2).
  or(expr) {
    const clauses = String(expr).split(",").map((c) => {
      const [col, op, ...rest] = c.split(".");
      return { col, op, val: rest.join(".") };
    });
    this.filters.push({ type: "or", clauses });
    return this;
  }
  order(col, opts) {
    this._order = { col, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n) {
    this._limit = n;
    return this;
  }
  select() {
    this._selectCalled = true;
    return this;
  }
  single() {
    this._single = true;
    return this;
  }
  maybeSingle() {
    this._maybeSingle = true;
    return this;
  }

  _matches(row) {
    return this.filters.every((f) => {
      if (f.type === "or") return f.clauses.some((c) => c.op === "eq" && String(row[c.col]) === String(c.val));
      if (f.type === "eq") return row[f.col] === f.val;
      if (f.type === "neq") return row[f.col] !== f.val;
      if (f.type === "gte") return row[f.col] >= f.val;
      if (f.type === "in") return f.val.includes(row[f.col]);
      return true;
    });
  }

  _execute() {
    if (this.op === "select") {
      let rows = this.table.rows.filter((r) => this._matches(r));
      if (this._order) {
        const { col, ascending } = this._order;
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1));
      }
      if (typeof this._limit === "number") rows = rows.slice(0, this._limit);
      if (this._single) {
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not exactly one row" } };
      }
      if (this._maybeSingle) {
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }
    if (this.op === "insert") {
      // Mirrors jobs_no_double_booking_idx (migration 048): a real
      // Postgres unique-violation (23505) if two non-cancelled, dated
      // jobs land on the same company/date/window - lets
      // booking.test.js exercise the race-condition error branch without
      // a live database.
      if (this.tableName === "jobs" && this.payload.scheduled_date && this.payload.status !== "cancelled") {
        const clashes = this.table.rows.some(
          (r) =>
            r.company_id === this.payload.company_id &&
            r.scheduled_date === this.payload.scheduled_date &&
            r.scheduled_window === this.payload.scheduled_window &&
            r.status !== "cancelled"
        );
        if (clashes) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"jobs_no_double_booking_idx\"" } };
        }
      }
      const row = { id: randomUUID(), created_at: new Date().toISOString(), ...this.payload };
      this.table.rows.push(row);
      if (this._selectCalled) {
        return this._single ? { data: row, error: null } : { data: [row], error: null };
      }
      return { data: null, error: null };
    }
    if (this.op === "update") {
      const matched = this.table.rows.filter((r) => this._matches(r));
      matched.forEach((r) => Object.assign(r, this.payload));
      return { data: this._selectCalled ? matched : null, error: null };
    }
    throw new Error(`FakeQueryBuilder: unhandled op ${this.op}`);
  }

  // Makes the builder itself awaitable, matching supabase-js - real code
  // does `await supabase.from(...).update(...).eq(...)` with no terminal
  // call, so `await` needs something to resolve here too.
  then(resolve, reject) {
    try {
      resolve(this._execute());
    } catch (err) {
      if (reject) reject(err);
      else resolve({ data: null, error: err });
    }
  }
}

/**
 * @param {Record<string, object[]>} seed - initial rows per table name
 */
function createFakeSupabase(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = { rows: rows.map((r) => ({ ...r })) };
  }
  return {
    // Exposed so tests can assert on what actually got written, e.g.
    // fake.table('jobs').rows.length === 1
    table(name) {
      if (!tables[name]) tables[name] = { rows: [] };
      return tables[name];
    },
    from(name) {
      if (!tables[name]) tables[name] = { rows: [] };
      const table = tables[name];
      return {
        select: (cols) => new FakeQueryBuilder(table, "select", undefined, name).select(cols),
        insert: (obj) => new FakeQueryBuilder(table, "insert", obj, name),
        update: (obj) => new FakeQueryBuilder(table, "update", obj, name),
      };
    },
  };
}

module.exports = { createFakeSupabase };
