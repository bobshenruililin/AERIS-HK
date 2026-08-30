/**
 * DuckDB window-function targeting query.
 *
 * Greedy 0/1 selection: rank by admissions-averted per m², take a prefix whose
 * running roof area stays within the budget. Buildings larger than the whole
 * budget are excluded. The same ORDER BY / SUM OVER / ROW_NUMBER logic is
 * mirrored in `selectCoolRoofsGreedyJs`.
 */
export const COOL_ROOF_WINDOW_SQL = `
WITH ranked AS (
  SELECT
    CAST(building_id AS VARCHAR) AS building_id,
    roof_m2::DOUBLE AS roof_m2,
    admissions_averted::DOUBLE AS admissions_averted,
    efficiency::DOUBLE AS efficiency,
    ROW_NUMBER() OVER (
      ORDER BY efficiency DESC, admissions_averted DESC, roof_m2 ASC, building_id
    ) AS rn,
    SUM(roof_m2) OVER (
      ORDER BY efficiency DESC, admissions_averted DESC, roof_m2 ASC, building_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cum_area_m2,
    SUM(admissions_averted) OVER (
      ORDER BY efficiency DESC, admissions_averted DESC, roof_m2 ASC, building_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cum_admissions_averted
  FROM cool_roof_candidates
  WHERE roof_m2 > 0 AND roof_m2 <= $BUDGET
)
SELECT
  building_id,
  roof_m2,
  admissions_averted,
  efficiency,
  rn,
  cum_area_m2,
  cum_admissions_averted
FROM ranked
WHERE cum_area_m2 <= $BUDGET
ORDER BY rn
`.trim();

export function bindCoolRoofSql(budgetM2: number): string {
  const budget = Number.isFinite(budgetM2) ? Math.max(0, budgetM2) : 0;
  return COOL_ROOF_WINDOW_SQL.replaceAll("$BUDGET", String(budget));
}

export function coolRoofSqlUsesWindowFunctions(sql: string = COOL_ROOF_WINDOW_SQL): boolean {
  const upper = sql.toUpperCase();
  return (
    upper.includes("ROW_NUMBER()") &&
    upper.includes("OVER (") &&
    upper.includes("SUM(ROOF_M2) OVER") &&
    upper.includes("SUM(ADMISSIONS_AVERTED) OVER") &&
    upper.includes("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW")
  );
}
