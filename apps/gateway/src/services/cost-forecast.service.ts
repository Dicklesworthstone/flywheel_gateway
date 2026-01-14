/**
 * Cost Forecast Service
 *
 * Generates cost forecasts using statistical methods.
 * Implements linear regression, exponential smoothing, and ensemble approaches.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { costForecasts, costRecords } from "../db/schema";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type {
  CostForecast,
  CostTrend,
  DailyForecast,
  ForecastMethodology,
  ForecastScenario,
} from "../models/cost";

// ============================================================================
// Constants
// ============================================================================

/** Default forecast horizon in days */
const DEFAULT_HORIZON_DAYS = 30;

/** Minimum historical days required for forecasting */
const _MIN_HISTORICAL_DAYS = 7;

/** Default historical days to use for training */
const DEFAULT_HISTORICAL_DAYS = 90;

/** Confidence level for prediction intervals */
const _CONFIDENCE_LEVEL = 0.95;

// ============================================================================
// Statistical Helpers
// ============================================================================

/**
 * Calculate mean of an array.
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate standard deviation of an array.
 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squareDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(
    squareDiffs.reduce((a, b) => a + b, 0) / (values.length - 1),
  );
}

/**
 * Simple linear regression.
 * Returns slope (m) and intercept (b) for y = mx + b.
 */
function linearRegression(
  xValues: number[],
  yValues: number[],
): { slope: number; intercept: number; r2: number } {
  const n = xValues.length;
  if (n < 2) {
    return { slope: 0, intercept: mean(yValues), r2: 0 };
  }

  const xMean = mean(xValues);
  const yMean = mean(yValues);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (xValues[i]! - xMean) * (yValues[i]! - yMean);
    denominator += (xValues[i]! - xMean) ** 2;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;

  // Calculate R-squared
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xValues[i]! + intercept;
    ssRes += (yValues[i]! - predicted) ** 2;
    ssTot += (yValues[i]! - yMean) ** 2;
  }
  const r2 = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

/**
 * Simple exponential smoothing.
 * Returns the smoothed forecast value.
 */
function exponentialSmoothing(values: number[], alpha: number = 0.3): number[] {
  if (values.length === 0) return [];

  const smoothed: number[] = [values[0]!];

  for (let i = 1; i < values.length; i++) {
    smoothed.push(alpha * values[i]! + (1 - alpha) * smoothed[i - 1]!);
  }

  return smoothed;
}

/**
 * Detect weekly seasonality in data.
 */
function detectSeasonality(dailyValues: number[]): boolean {
  if (dailyValues.length < 14) return false;

  // Simple check: compare variance within weeks vs across weeks
  const weeks: number[][] = [];
  for (let i = 0; i < dailyValues.length; i += 7) {
    const week = dailyValues.slice(i, Math.min(i + 7, dailyValues.length));
    if (week.length === 7) {
      weeks.push(week);
    }
  }

  if (weeks.length < 2) return false;

  // Calculate average day-of-week pattern
  const dayAverages = Array.from({ length: 7 }, () => [] as number[]);
  for (const week of weeks) {
    for (let d = 0; d < 7; d++) {
      dayAverages[d]!.push(week[d]!);
    }
  }

  // Check if day-of-week variation is significant
  const dayMeans = dayAverages.map(mean);
  const _overallMean = mean(dailyValues);
  const dayVariation = stdDev(dayMeans);
  const overallVariation = stdDev(dailyValues);

  // Seasonality is significant if day-of-week variation is >20% of overall variation
  return overallVariation > 0 && dayVariation / overallVariation > 0.2;
}

// ============================================================================
// Forecasting Methods
// ============================================================================

/**
 * Generate forecast using linear trend.
 */
function forecastLinear(
  historicalData: Array<{ date: Date; costUnits: number }>,
  horizonDays: number,
): DailyForecast[] {
  const n = historicalData.length;
  if (n === 0) {
    return [];
  }

  // Convert dates to day indices
  const baseDate = historicalData[0]!.date.getTime();
  const xValues = historicalData.map(
    (d) => (d.date.getTime() - baseDate) / (24 * 60 * 60 * 1000),
  );
  const yValues = historicalData.map((d) => d.costUnits);

  const { slope, intercept } = linearRegression(xValues, yValues);

  // Calculate prediction error for confidence intervals
  const predictions = xValues.map((x) => slope * x + intercept);
  const errors = yValues.map((y, i) => y - predictions[i]!);
  const errorStd = stdDev(errors);

  // Z-score for 95% confidence
  const zScore = 1.96;

  const forecasts: DailyForecast[] = [];
  const lastX = xValues[xValues.length - 1]!;

  for (let i = 1; i <= horizonDays; i++) {
    const x = lastX + i;
    const predicted = Math.max(0, slope * x + intercept);

    // Confidence interval widens with forecast horizon
    const intervalWidth =
      zScore * errorStd * Math.sqrt(1 + 1 / n + (i * i) / n);

    const date = new Date(baseDate + x * 24 * 60 * 60 * 1000);
    forecasts.push({
      date,
      predictedCostUnits: Math.round(predicted),
      lowerBoundUnits: Math.round(Math.max(0, predicted - intervalWidth)),
      upperBoundUnits: Math.round(predicted + intervalWidth),
      confidence: Math.max(0.5, 1 - i / (horizonDays * 2)), // Decreasing confidence
    });
  }

  return forecasts;
}

/**
 * Generate forecast using exponential smoothing.
 */
function forecastExponential(
  historicalData: Array<{ date: Date; costUnits: number }>,
  horizonDays: number,
): DailyForecast[] {
  if (historicalData.length === 0) {
    return [];
  }

  const values = historicalData.map((d) => d.costUnits);
  const smoothed = exponentialSmoothing(values, 0.3);
  const lastSmoothed = smoothed[smoothed.length - 1]!;

  // Calculate trend from smoothed data
  const recentSmoothed = smoothed.slice(-14);
  const trend =
    recentSmoothed.length > 1
      ? (recentSmoothed[recentSmoothed.length - 1]! - recentSmoothed[0]!) /
        recentSmoothed.length
      : 0;

  // Error estimation
  const errors = values.map((v, i) => v - smoothed[i]!);
  const errorStd = stdDev(errors);
  const zScore = 1.96;

  const forecasts: DailyForecast[] = [];
  const lastDate = historicalData[historicalData.length - 1]!.date;

  for (let i = 1; i <= horizonDays; i++) {
    const predicted = Math.max(0, lastSmoothed + trend * i);
    const intervalWidth = zScore * errorStd * Math.sqrt(i);

    const date = new Date(lastDate.getTime() + i * 24 * 60 * 60 * 1000);
    forecasts.push({
      date,
      predictedCostUnits: Math.round(predicted),
      lowerBoundUnits: Math.round(Math.max(0, predicted - intervalWidth)),
      upperBoundUnits: Math.round(predicted + intervalWidth),
      confidence: Math.max(0.5, 1 - i / (horizonDays * 2)),
    });
  }

  return forecasts;
}

/**
 * Generate ensemble forecast (average of methods).
 */
function forecastEnsemble(
  historicalData: Array<{ date: Date; costUnits: number }>,
  horizonDays: number,
): DailyForecast[] {
  const linearForecasts = forecastLinear(historicalData, horizonDays);
  const exponentialForecasts = forecastExponential(historicalData, horizonDays);

  if (linearForecasts.length === 0) return exponentialForecasts;
  if (exponentialForecasts.length === 0) return linearForecasts;

  return linearForecasts.map((lf, i) => {
    const ef = exponentialForecasts[i]!;
    return {
      date: lf.date,
      predictedCostUnits: Math.round(
        (lf.predictedCostUnits + ef.predictedCostUnits) / 2,
      ),
      lowerBoundUnits: Math.round(
        Math.min(lf.lowerBoundUnits, ef.lowerBoundUnits),
      ),
      upperBoundUnits: Math.round(
        Math.max(lf.upperBoundUnits, ef.upperBoundUnits),
      ),
      confidence: (lf.confidence + ef.confidence) / 2,
    };
  });
}

// ============================================================================
// Main Forecast Generation
// ============================================================================

/**
 * Generate a cost forecast.
 */
export async function generateForecast(options: {
  organizationId?: string;
  projectId?: string;
  horizonDays?: number;
  historicalDays?: number;
  methodology?: ForecastMethodology;
}): Promise<CostForecast> {
  const correlationId = getCorrelationId();
  const log = getLogger();

  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const historicalDays = options.historicalDays ?? DEFAULT_HISTORICAL_DAYS;
  const methodology = options.methodology ?? "ensemble";

  // Fetch historical data
  const since = new Date(Date.now() - historicalDays * 24 * 60 * 60 * 1000);
  const conditions = [gte(costRecords.timestamp, since)];

  if (options.organizationId) {
    conditions.push(eq(costRecords.organizationId, options.organizationId));
  }
  if (options.projectId) {
    conditions.push(eq(costRecords.projectId, options.projectId));
  }

  const dailyData = await db
    .select({
      date: sql<string>`date(${costRecords.timestamp})`,
      costUnits: sql<number>`sum(${costRecords.totalCostUnits})`,
    })
    .from(costRecords)
    .where(and(...conditions))
    .groupBy(sql`date(${costRecords.timestamp})`)
    .orderBy(sql`date(${costRecords.timestamp})`);

  const historicalData = dailyData.map((row) => ({
    date: new Date(row.date),
    costUnits: row.costUnits,
  }));

  // Generate forecasts based on methodology
  let dailyForecasts: DailyForecast[];
  switch (methodology) {
    case "linear":
      dailyForecasts = forecastLinear(historicalData, horizonDays);
      break;
    case "exponential":
      dailyForecasts = forecastExponential(historicalData, horizonDays);
      break;
    default:
      dailyForecasts = forecastEnsemble(historicalData, horizonDays);
      break;
  }

  // Calculate totals and confidence intervals
  const totalForecastUnits = dailyForecasts.reduce(
    (sum, f) => sum + f.predictedCostUnits,
    0,
  );
  const confidenceLower = dailyForecasts.reduce(
    (sum, f) => sum + f.lowerBoundUnits,
    0,
  );
  const confidenceUpper = dailyForecasts.reduce(
    (sum, f) => sum + f.upperBoundUnits,
    0,
  );

  // Detect trend and seasonality
  const values = historicalData.map((d) => d.costUnits);
  const seasonalityDetected = detectSeasonality(values);

  // Calculate trend direction
  let trendDirection: CostTrend = "stable";
  let trendStrength = 0;
  if (historicalData.length >= 7) {
    const recent = values.slice(-7);
    const earlier = values.slice(-14, -7);
    if (earlier.length > 0) {
      const recentMean = mean(recent);
      const earlierMean = mean(earlier);
      const change =
        earlierMean > 0 ? (recentMean - earlierMean) / earlierMean : 0;
      if (change > 0.1) {
        trendDirection = "up";
        trendStrength = Math.min(1, change);
      } else if (change < -0.1) {
        trendDirection = "down";
        trendStrength = Math.min(1, Math.abs(change));
      }
    }
  }

  // Calculate accuracy metrics (based on validation if enough data)
  let mape = 0;
  let rmse = 0;
  if (historicalData.length > 14) {
    // Use last 7 days for validation
    const trainData = historicalData.slice(0, -7);
    const testData = historicalData.slice(-7);
    const testForecasts = forecastEnsemble(trainData, 7);

    let sumAbsPercent = 0;
    let sumSquaredError = 0;
    for (let i = 0; i < testData.length && i < testForecasts.length; i++) {
      const actual = testData[i]!.costUnits;
      const predicted = testForecasts[i]!.predictedCostUnits;
      if (actual > 0) {
        sumAbsPercent += Math.abs((actual - predicted) / actual);
      }
      sumSquaredError += (actual - predicted) ** 2;
    }
    mape = (sumAbsPercent / testData.length) * 100;
    rmse = Math.sqrt(sumSquaredError / testData.length);
  }

  // Generate unique ID
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  const id = `forecast_${Date.now()}_${random}`;

  const forecast: CostForecast = {
    id,
    forecastDate: new Date(),
    horizonDays,
    ...(options.organizationId !== undefined && {
      organizationId: options.organizationId,
    }),
    ...(options.projectId !== undefined && { projectId: options.projectId }),
    dailyForecasts,
    totalForecastUnits,
    confidenceInterval95: {
      lower: confidenceLower,
      upper: confidenceUpper,
    },
    methodology,
    accuracyMetrics: {
      mape,
      rmse,
    },
    historicalDaysUsed: historicalData.length,
    seasonalityDetected,
    trendDirection,
    trendStrength,
    createdAt: new Date(),
  };

  // Store forecast in database
  await db.insert(costForecasts).values({
    id: forecast.id,
    organizationId: forecast.organizationId ?? null,
    projectId: forecast.projectId ?? null,
    forecastDate: forecast.forecastDate,
    horizonDays: forecast.horizonDays,
    methodology: forecast.methodology,
    dailyForecasts: forecast.dailyForecasts,
    totalForecastUnits: forecast.totalForecastUnits,
    confidenceLower: forecast.confidenceInterval95.lower,
    confidenceUpper: forecast.confidenceInterval95.upper,
    mape: forecast.accuracyMetrics.mape,
    rmse: forecast.accuracyMetrics.rmse,
    historicalDaysUsed: forecast.historicalDaysUsed,
    seasonalityDetected: forecast.seasonalityDetected,
    trendDirection: forecast.trendDirection,
    trendStrength: forecast.trendStrength,
    createdAt: forecast.createdAt,
  });

  log.info({
    type: "forecast:generated",
    correlationId,
    forecastId: id,
    horizonDays,
    methodology,
    totalForecastUnits,
    historicalDaysUsed: historicalData.length,
  });

  return forecast;
}

/**
 * Get the latest forecast.
 */
export async function getLatestForecast(filter?: {
  organizationId?: string;
  projectId?: string;
}): Promise<CostForecast | undefined> {
  const conditions = [];

  if (filter?.organizationId) {
    conditions.push(eq(costForecasts.organizationId, filter.organizationId));
  }
  if (filter?.projectId) {
    conditions.push(eq(costForecasts.projectId, filter.projectId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(costForecasts)
    .where(whereClause)
    .orderBy(desc(costForecasts.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return undefined;
  }

  const row = rows[0]!;
  const result: CostForecast = {
    id: row.id,
    forecastDate: row.forecastDate,
    horizonDays: row.horizonDays,
    dailyForecasts: row.dailyForecasts as DailyForecast[],
    totalForecastUnits: row.totalForecastUnits,
    confidenceInterval95: {
      lower: row.confidenceLower,
      upper: row.confidenceUpper,
    },
    methodology: row.methodology as ForecastMethodology,
    accuracyMetrics: {
      mape: row.mape ?? 0,
      rmse: row.rmse ?? 0,
    },
    historicalDaysUsed: row.historicalDaysUsed,
    seasonalityDetected: row.seasonalityDetected,
    trendDirection: (row.trendDirection as CostTrend) ?? "stable",
    trendStrength: row.trendStrength ?? 0,
    createdAt: row.createdAt,
  };
  if (row.organizationId !== null) {
    result.organizationId = row.organizationId;
  }
  if (row.projectId !== null) {
    result.projectId = row.projectId;
  }
  return result;
}

/**
 * Generate scenario analysis.
 */
export async function generateScenarios(
  baseForecast: CostForecast,
): Promise<ForecastScenario[]> {
  const scenarios: ForecastScenario[] = [];

  // Optimistic scenario (-20%)
  scenarios.push({
    name: "Optimistic",
    description: "20% reduction through optimization",
    adjustmentPercent: -20,
    totalForecastUnits: Math.round(baseForecast.totalForecastUnits * 0.8),
    dailyForecasts: baseForecast.dailyForecasts.map((f) => ({
      ...f,
      predictedCostUnits: Math.round(f.predictedCostUnits * 0.8),
      lowerBoundUnits: Math.round(f.lowerBoundUnits * 0.8),
      upperBoundUnits: Math.round(f.upperBoundUnits * 0.8),
    })),
  });

  // Base scenario (current forecast)
  scenarios.push({
    name: "Base",
    description: "Current trend continues",
    adjustmentPercent: 0,
    totalForecastUnits: baseForecast.totalForecastUnits,
    dailyForecasts: baseForecast.dailyForecasts,
  });

  // Growth scenario (+30%)
  scenarios.push({
    name: "Growth",
    description: "30% increase from scaling",
    adjustmentPercent: 30,
    totalForecastUnits: Math.round(baseForecast.totalForecastUnits * 1.3),
    dailyForecasts: baseForecast.dailyForecasts.map((f) => ({
      ...f,
      predictedCostUnits: Math.round(f.predictedCostUnits * 1.3),
      lowerBoundUnits: Math.round(f.lowerBoundUnits * 1.1),
      upperBoundUnits: Math.round(f.upperBoundUnits * 1.5),
    })),
  });

  return scenarios;
}

/**
 * Get forecast for a specific date.
 */
export function getForecastForDate(
  forecast: CostForecast,
  date: Date,
): DailyForecast | undefined {
  const targetDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  return forecast.dailyForecasts.find((f) => {
    const forecastDate = new Date(
      f.date.getFullYear(),
      f.date.getMonth(),
      f.date.getDate(),
    );
    return forecastDate.getTime() === targetDate.getTime();
  });
}

/**
 * Calculate forecast accuracy for a completed period.
 */
export async function calculateForecastAccuracy(forecastId: string): Promise<
  | {
      forecastId: string;
      validatedDays: number;
      mape: number;
      rmse: number;
      accuracy: number;
    }
  | undefined
> {
  const rows = await db
    .select()
    .from(costForecasts)
    .where(eq(costForecasts.id, forecastId))
    .limit(1);

  if (rows.length === 0) {
    return undefined;
  }

  const forecast = rows[0]!;
  const dailyForecasts = forecast.dailyForecasts as DailyForecast[];

  // Get actual costs for forecast period
  const conditions = [];
  if (forecast.organizationId) {
    conditions.push(eq(costRecords.organizationId, forecast.organizationId));
  }
  if (forecast.projectId) {
    conditions.push(eq(costRecords.projectId, forecast.projectId));
  }

  const now = new Date();
  let validatedDays = 0;
  let sumAbsPercent = 0;
  let sumSquaredError = 0;

  for (const df of dailyForecasts) {
    const forecastDate = new Date(df.date);
    if (forecastDate > now) break;

    const nextDay = new Date(forecastDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const dayConditions = [
      ...conditions,
      gte(costRecords.timestamp, forecastDate),
      lte(costRecords.timestamp, nextDay),
    ];

    const actual = await db
      .select({
        costUnits: sql<number>`sum(${costRecords.totalCostUnits})`,
      })
      .from(costRecords)
      .where(and(...dayConditions));

    const actualUnits = actual[0]?.costUnits ?? 0;
    if (actualUnits > 0) {
      validatedDays++;
      sumAbsPercent += Math.abs(
        (actualUnits - df.predictedCostUnits) / actualUnits,
      );
      sumSquaredError += (actualUnits - df.predictedCostUnits) ** 2;
    }
  }

  if (validatedDays === 0) {
    return undefined;
  }

  const mape = (sumAbsPercent / validatedDays) * 100;
  const rmse = Math.sqrt(sumSquaredError / validatedDays);
  const accuracy = Math.max(0, 100 - mape);

  return {
    forecastId,
    validatedDays,
    mape,
    rmse,
    accuracy,
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all forecast data (for testing).
 */
export async function clearForecastData(): Promise<void> {
  await db.delete(costForecasts);
}
