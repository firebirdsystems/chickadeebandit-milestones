import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const VALID_STORAGE   = ["kv", "db", "none"];
const VALID_AUDIENCES = ["everyone", "adults", "children"];

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static",        () => expect(manifest.runtime).toBe("static"));

  it("storage is declared and valid", () => {
    expect(manifest.storage, "storage field is required").toBeTruthy();
    expect(VALID_STORAGE).toContain(manifest.storage);
  });

  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));

  it("permissions.default_audience is valid", () => {
    expect(VALID_AUDIENCES).toContain(manifest.permissions.default_audience);
  });

  it("permissions.requires_approval is boolean", () => {
    expect(typeof manifest.permissions.requires_approval).toBe("boolean");
  });

  it("data_access has reads and writes arrays", () => {
    expect(Array.isArray(manifest.data_access.reads)).toBe(true);
    expect(Array.isArray(manifest.data_access.writes)).toBe(true);
  });

  it("declares household preferences for timezone-correct dates", () => {
    expect(manifest.data_access.reads).toContain("family.preferences");
  });

  it("glance only surfaces past milestones", () => {
    expect(manifest.glance.source.query).toContain("p.archived_at IS NULL");
    expect(manifest.glance.source.query).toContain("m.occurred_date < :today");
  });

  it("glance keeps household milestones and drops fully-archived ones", () => {
    // Mirrors isVisibleMilestone: no attachments at all is a household
    // milestone and always shows; attachments that are all archived do not.
    expect(manifest.glance.source.query).toContain("HAVING COUNT(mp.id) = 0 OR COUNT(p.id) > 0");
    expect(manifest.glance.source.query).toContain("'Our household'");
  });

  it("glance never shows a stale stored name for a roster-linked person", () => {
    expect(manifest.glance.source.query).toContain("MAX(p.member_id) <> ''");
    expect(manifest.glance.source.query).toContain("Household member");
  });

  it("glance never concatenates encrypted names", () => {
    // decryptAppRows decrypts by VALUE, not by column: a group_concat of two
    // encrypted names produces a string that is no longer a single ciphertext,
    // so the card would render raw bytes. Every branch of the subtitle is a
    // literal or one whole column value.
    expect(manifest.glance.source.query).not.toMatch(/group_concat/i);
    expect(manifest.glance.source.query).not.toMatch(/\|\|/);
  });

  it("joins every governed table at the top level", () => {
    // The row-policy rewriter fails closed on a governed table reached only
    // through a subquery or CTE, so the glance may not resolve names that way.
    for (const table of ["app_milestones__milestone_people", "app_milestones__people"]) {
      expect(manifest.glance.source.query).toContain(`LEFT JOIN ${table}`);
    }
  });

  it("only adults may archive or restore someone", () => {
    expect(manifest.row_policies.people.column_write_acls.archived_at).toEqual({
      writable_by: ["adult"],
    });
  });

  it("durably reclaims photos removed by an update", () => {
    expect(manifest.update_file_list_columns).toEqual({ milestones: ["file_ids"] });
  });

  it("governs the join table by its milestone, not by its own visibility", () => {
    expect(manifest.row_policies.milestone_people).toEqual({
      kind: "inherit_visibility",
      parent_table: "milestones",
      fk_column: "milestone_id",
      writer_column: "written_by",
      max_rows: 20000,
    });
  });

  it("takes a milestone's attachments with it, from either side", () => {
    // Both directions matter: deleting a milestone must not strand its
    // attachments, and neither must deleting a person.
    expect(manifest.delete_cascades.milestones).toEqual([
      { table: "milestone_people", foreign_key: "milestone_id" },
    ]);
    expect(manifest.delete_cascades.people).toEqual([
      { table: "milestone_people", foreign_key: "person_id" },
    ]);
  });

  it("attributes the member who attached someone", () => {
    expect(manifest.member_references.milestone_people).toEqual([
      { column: "written_by", on_removed: "keep" },
    ]);
  });

  it("a milestone belongs to the household, not to one person", () => {
    // The schema has no subject_id: people attach through the join table, so
    // "we got the keys" needs no stand-in person to hang off.
    const sql = readFileSync(join(__dirname, "../migrations/001_init.sql"), "utf-8");
    expect(sql).not.toContain("subject_id");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS app_milestones__milestone_people");
  });

  it("keeps the join table's keys plaintext so they can be joined", () => {
    const sql = readFileSync(join(__dirname, "../migrations/001_init.sql"), "utf-8");
    const table = sql.slice(sql.indexOf("app_milestones__milestone_people ("));
    const columns = table.slice(0, table.indexOf(");")).match(/^\s{2}(\w+)/gm).map((c) => c.trim());
    // Encrypted keys cannot be compared in SQL, and the UNIQUE index below
    // would be dead on arrival over them.
    for (const column of columns) {
      expect(column, `${column} must be plaintext by suffix`).toMatch(/(_id|_by|_at)$|^id$/);
    }
  });

  it("AI exports identify attached people without returning a stale cached name", () => {
    const sql = readFileSync(join(__dirname, "../src/queries/milestone_timeline.sql"), "utf-8");
    expect(sql).toContain("p.member_id AS person_member_id");
    expect(sql).toContain("p.member_id = '' THEN p.name ELSE NULL");
    // LEFT JOIN, so a household milestone still exports.
    expect(sql).toContain("LEFT JOIN app_milestones__milestone_people");
  });
});

// ── ai_access SQL file validation ─────────────────────────────────────────────
// Auto-discovers all db_exports/db_mutations/db_inserts/db_deletes entries and
// validates each SQL file for type, household_id filter, and single-statement.

if (manifest.ai_access) {
  const ai = manifest.ai_access;

  const SQL_TYPES = [
    { field: "db_exports",   dir: "queries",   keyword: /^(SELECT|WITH)\b/i, label: "SELECT or WITH" },
    { field: "db_mutations", dir: "mutations",  keyword: /^UPDATE\b/i,        label: "UPDATE"         },
    { field: "db_inserts",   dir: "inserts",    keyword: /^INSERT\b/i,        label: "INSERT"         },
    { field: "db_deletes",   dir: "deletes",    keyword: /^DELETE\b/i,        label: "DELETE"         },
  ];

  for (const { field, dir, keyword, label } of SQL_TYPES) {
    const names = ai[field] ?? [];
    if (names.length === 0) continue;

    describe(`ai_access.${field}`, () => {
      it(`each name has a src/${dir}/{name}.sql file`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          expect(existsSync(path), `missing: src/${dir}/${name}.sql`).toBe(true);
        }
      });

      it(`each SQL file starts with ${label}`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          if (!existsSync(path)) continue;
          const sql = readFileSync(path, "utf-8").trim();
          expect(
            keyword.test(sql),
            `src/${dir}/${name}.sql must start with ${label}, got: ${sql.slice(0, 50)}`
          ).toBe(true);
        }
      });

      it(`each SQL file is a single statement (no semicolons)`, () => {
        for (const name of names) {
          const path = join(__dirname, `../src/${dir}/${name}.sql`);
          if (!existsSync(path)) continue;
          const sql = readFileSync(path, "utf-8");
          expect(
            sql.includes(";"),
            `src/${dir}/${name}.sql must not contain semicolons`
          ).toBe(false);
        }
      });
    });
  }

  if (ai.db_inserts?.length) {
    describe("ai_access.db_inserts schemas", () => {
      it("each insert has a src/schemas/{name}.json file", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          expect(existsSync(path), `missing: src/schemas/${name}.json`).toBe(true);
        }
      });

      it("each schema file is valid JSON", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          if (!existsSync(path)) continue;
          expect(
            () => JSON.parse(readFileSync(path, "utf-8")),
            `src/schemas/${name}.json must be valid JSON`
          ).not.toThrow();
        }
      });

      it("each schema declares type:array with an items definition", () => {
        for (const name of ai.db_inserts) {
          const path = join(__dirname, `../src/schemas/${name}.json`);
          if (!existsSync(path)) continue;
          let schema;
          try { schema = JSON.parse(readFileSync(path, "utf-8")); } catch { continue; }
          expect(schema.type, `src/schemas/${name}.json must declare "type": "array"`).toBe("array");
          expect(
            Array.isArray(schema.items) || (typeof schema.items === "object" && schema.items !== null),
            `src/schemas/${name}.json must declare "items" to validate params`
          ).toBe(true);
        }
      });

      it("schema maxItems matches the number of $N placeholders in the SQL", () => {
        for (const name of ai.db_inserts) {
          const sqlPath    = join(__dirname, `../src/inserts/${name}.sql`);
          const schemaPath = join(__dirname, `../src/schemas/${name}.json`);
          if (!existsSync(sqlPath) || !existsSync(schemaPath)) continue;
          const sql = readFileSync(sqlPath, "utf-8");
          let schema;
          try { schema = JSON.parse(readFileSync(schemaPath, "utf-8")); } catch { continue; }
          const paramNums = [...sql.matchAll(/\$(\d+)/g)].map(m => parseInt(m[1], 10));
          const maxParam  = paramNums.length > 0 ? Math.max(...paramNums) : 0;
          expect(
            schema.maxItems,
            `src/schemas/${name}.json maxItems (${schema.maxItems}) must equal SQL $N count (${maxParam})`
          ).toBe(maxParam);
        }
      });
    });
  }
}
