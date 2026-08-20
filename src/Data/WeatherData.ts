import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type WeatherDay = {
    date: string;
    dayName: string;
    weatherCode: string;
    weatherLabel: string;
    iconSvg: string;
    maxTemp: number;
    minTemp: number;
    precipitationMm: number;
};

export type WeatherData = {
    location: string;

    current: {
        temperature: number;
        apparentTemperature: number;
        weatherCode: string;
        weatherLabel: string;
        iconSvg: string;
        windSpeed: number;
    };

    today: WeatherDay;
    forecast: WeatherDay[];
};


/* ============================================================
   LOCATION
   ============================================================ */

const LATITUDE = 59.9512;
const LONGITUDE = 10.8678;


/* ============================================================
   MET NORWAY
   ============================================================ */

const MET_URL =
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LATITUDE}&lon=${LONGITUDE}`;

const MET_USER_AGENT =
    "KalbakkenKindleWeather/1.0 https://github.com/renbjodev/byos_node_lite";


/* ============================================================
   CACHE
   ============================================================ */

let cachedWeather: WeatherData | null = null;
let cacheExpiresAt = 0;

let weatherRequestInProgress: Promise<WeatherData> | null = null;

const iconCache = new Map<string, string>();


/* ============================================================
   MET TYPES
   ============================================================ */

type MetEntry = {
    time: string;

    data: {
        instant: {
            details: {
                air_temperature?: number;
                wind_speed?: number;
                cloud_area_fraction?: number;
            };
        };

        next_1_hours?: {
            summary?: {
                symbol_code?: string;
            };

            details?: {
                precipitation_amount?: number;
            };
        };

        next_6_hours?: {
            summary?: {
                symbol_code?: string;
            };

            details?: {
                precipitation_amount?: number;
            };
        };

        next_12_hours?: {
            summary?: {
                symbol_code?: string;
            };
        };
    };
};


/* ============================================================
   TIME HELPERS
   ============================================================ */

function osloDateString(date: Date): string {

    return new Intl.DateTimeFormat(
        "sv-SE",
        {
            timeZone: "Europe/Oslo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }
    ).format(date);
}


function osloHour(date: Date): number {

    return Number(
        new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Europe/Oslo",
                hour: "2-digit",
                hour12: false,
            }
        ).format(date)
    );
}


function norwegianDay(dateString: string): string {

    const names = [
        "SØN",
        "MAN",
        "TIR",
        "ONS",
        "TOR",
        "FRE",
        "LØR",
    ];

    /*
     * Noon avoids timezone/date-boundary issues.
     */
    const date =
        new Date(`${dateString}T12:00:00`);

    return names[date.getDay()];
}


/* ============================================================
   SYMBOL HELPERS
   ============================================================ */

function baseSymbol(symbolCode: string): string {

    return symbolCode
        .replace("_day", "")
        .replace("_night", "")
        .replace("_polartwilight", "");
}


function weatherLabel(symbolCode: string): string {

    const code =
        baseSymbol(symbolCode);


    if (code === "clearsky") {
        return "Klart";
    }

    if (code === "fair") {
        return "For det meste klart";
    }

    if (code === "partlycloudy") {
        return "Delvis skyet";
    }

    if (code === "cloudy") {
        return "Overskyet";
    }

    if (code === "fog") {
        return "Tåke";
    }


    if (code.includes("heavyrain")) {
        return "Kraftig regn";
    }

    if (code.includes("lightrain")) {
        return "Lett regn";
    }

    if (code.includes("rainshowers")) {
        return "Regnbyger";
    }

    if (code.includes("rain")) {
        return "Regn";
    }


    if (code.includes("heavysnow")) {
        return "Kraftig snø";
    }

    if (code.includes("lightsnow")) {
        return "Lett snø";
    }

    if (code.includes("snowshowers")) {
        return "Snøbyger";
    }

    if (code.includes("snow")) {
        return "Snø";
    }


    if (code.includes("sleet")) {
        return "Sludd";
    }


    if (code.includes("thunder")) {
        return "Torden";
    }


    return "Ukjent";
}


/* ============================================================
   MET SYMBOL → METEOCONS
   ============================================================ */

function meteoconName(symbolCode: string): string {

    const isNight =
        symbolCode.includes("_night");

    const suffix =
        isNight ? "night" : "day";

    const code =
        baseSymbol(symbolCode);


    if (code === "clearsky") {
        return isNight
            ? "clear-night"
            : "clear-day";
    }

    if (code === "fair") {
        return `partly-cloudy-${suffix}`;
    }

    if (code === "partlycloudy") {
        return `partly-cloudy-${suffix}`;
    }

    if (code === "cloudy") {
        return "overcast";
    }

    if (code === "fog") {
        return isNight
            ? "fog-night"
            : "fog-day";
    }


    if (code.includes("heavyrainshowers")) {
        return `extreme-${suffix}-rain`;
    }

    if (code.includes("rainshowers")) {
        return `partly-cloudy-${suffix}-rain`;
    }

    if (code.includes("heavyrain")) {
        return "extreme-rain";
    }

    if (code.includes("lightrain")) {
        return "drizzle";
    }

    if (code.includes("rain")) {
        return "rain";
    }


    if (code.includes("heavysnowshowers")) {
        return `extreme-${suffix}-snow`;
    }

    if (code.includes("snowshowers")) {
        return `partly-cloudy-${suffix}-snow`;
    }

    if (code.includes("heavysnow")) {
        return "extreme-snow";
    }

    if (code.includes("snow")) {
        return "snow";
    }


    if (code.includes("sleet")) {
        return "sleet";
    }


    if (code.includes("thunder")) {
        return `thunderstorms-${suffix}-rain`;
    }


    return "overcast";
}


/* ============================================================
   LOCAL METEOCONS
   ============================================================ */

async function getMeteoconSvg(
    iconName: string
): Promise<string> {

    const cached =
        iconCache.get(iconName);

    if (cached) {
        return cached;
    }


    const iconPath =
        join(
            process.cwd(),
            "node_modules",
            "@meteocons",
            "svg-static",
            "monochrome",
            `${iconName}.svg`
        );


    try {

        let svg =
            await readFile(
                iconPath,
                "utf8"
            );


        svg =
            svg.replaceAll(
                "currentColor",
                "#000000"
            );


        svg =
            svg.replace(
                /<\?xml[^>]*\?>/g,
                ""
            );


        iconCache.set(
            iconName,
            svg
        );


        return svg;

    } catch (error) {

        console.error(
            `Failed to load Meteocon "${iconName}"`
        );


        if (iconName !== "overcast") {

            return getMeteoconSvg(
                "overcast"
            );
        }


        console.error(
            "Could not load Meteocons fallback icon.",
            error
        );


        return "";
    }
}


/* ============================================================
   PRECIPITATION AGGREGATION
   ============================================================ */

type PrecipPeriod = {
    start: number;
    end: number;
    amount: number;
};


/*
 * Build non-overlapping precipitation periods.
 *
 * Near-term MET data has next_1_hours.
 * Longer-range data mainly has next_6_hours.
 *
 * We use the 1-hour periods first because they are most precise,
 * then add 6-hour periods only when they do not overlap already
 * counted periods.
 */
function dailyPrecipitation(
    entries: MetEntry[]
): number {

    const periods: PrecipPeriod[] = [];


    /* --------------------------------------------------------
       1 HOUR PERIODS
       -------------------------------------------------------- */

    for (const entry of entries) {

        const amount =
            entry.data
                .next_1_hours
                ?.details
                ?.precipitation_amount;


        if (typeof amount !== "number") {
            continue;
        }


        const start =
            new Date(entry.time).getTime();


        periods.push({
            start,
            end: start + 60 * 60 * 1000,
            amount,
        });
    }


    /*
     * Keep track of periods already covered by hourly data.
     */
    const covered =
        periods.map(
            period => ({
                start: period.start,
                end: period.end,
            })
        );


    /* --------------------------------------------------------
       6 HOUR PERIODS
       -------------------------------------------------------- */

    const sixHourCandidates: PrecipPeriod[] =
        [];


    for (const entry of entries) {

        const amount =
            entry.data
                .next_6_hours
                ?.details
                ?.precipitation_amount;


        if (typeof amount !== "number") {
            continue;
        }


        const start =
            new Date(entry.time).getTime();


        sixHourCandidates.push({
            start,
            end:
                start
                +
                6 * 60 * 60 * 1000,
            amount,
        });
    }


    sixHourCandidates.sort(
        (a, b) =>
            a.start - b.start
    );


    for (const candidate of sixHourCandidates) {

        /*
         * Does this 6-hour forecast overlap data
         * we have already counted?
         */
        const overlaps =
            covered.some(
                existing =>
                    candidate.start < existing.end
                    &&
                    candidate.end > existing.start
            );


        if (overlaps) {
            continue;
        }


        periods.push(
            candidate
        );


        covered.push({
            start:
                candidate.start,

            end:
                candidate.end,
        });
    }


    const total =
        periods.reduce(
            (
                sum,
                period
            ) =>
                sum + period.amount,
            0
        );


    return (
        Math.round(total * 10) / 10
    );
}


/* ============================================================
   DAYTIME WEATHER SELECTION
   ============================================================ */

/*
 * Return the entry closest to local noon.
 */
function closestToNoon(
    entries: MetEntry[]
): MetEntry {

    return [...entries]
        .sort(
            (a, b) => {

                const aDistance =
                    Math.abs(
                        osloHour(
                            new Date(a.time)
                        ) - 12
                    );


                const bDistance =
                    Math.abs(
                        osloHour(
                            new Date(b.time)
                        ) - 12
                    );


                return (
                    aDistance
                    -
                    bDistance
                );
            }
        )[0];
}


/*
 * Pick the most meaningful precipitation symbol
 * during daytime.
 */
function daytimePrecipitationSymbol(
    entries: MetEntry[]
): string | null {

    const daytime =
        entries.filter(
            entry => {

                const hour =
                    osloHour(
                        new Date(entry.time)
                    );

                return (
                    hour >= 8
                    &&
                    hour <= 19
                );
            }
        );


    let bestSymbol:
        string | null = null;

    let bestAmount = 0;


    for (const entry of daytime) {

        const amount =
            entry.data
                .next_1_hours
                ?.details
                ?.precipitation_amount
            ??
            0;


        const symbol =
            entry.data
                .next_1_hours
                ?.summary
                ?.symbol_code;


        if (
            symbol
            &&
            amount > bestAmount
        ) {

            bestAmount =
                amount;

            bestSymbol =
                symbol;
        }
    }


    /*
     * Only let precipitation override the normal
     * daytime icon when it is actually meaningful.
     *
     * 0.2 mm/hour avoids turning a mostly sunny day
     * into a rain icon because of negligible drizzle.
     */
    if (
        bestSymbol
        &&
        bestAmount >= 0.2
    ) {

        return bestSymbol;
    }


    return null;
}


/*
 * Build a sky-condition symbol directly from cloud cover
 * around noon.
 *
 * This avoids using a 6-hour summary to represent one
 * specific moment in the middle of the day.
 */
function skySymbolFromNoon(
    entry: MetEntry
): string {

    const cloud =
        entry.data
            .instant
            .details
            .cloud_area_fraction;


    /*
     * If MET does not supply cloud coverage,
     * fall back to its closest available symbol.
     */
    if (typeof cloud !== "number") {

        return (
            entry.data
                .next_1_hours
                ?.summary
                ?.symbol_code

            ??

            entry.data
                .next_6_hours
                ?.summary
                ?.symbol_code

            ??

            entry.data
                .next_12_hours
                ?.summary
                ?.symbol_code

            ??

            "cloudy"
        );
    }


    /*
     * Approximate MET/Yr-style sky categories.
     */
    if (cloud <= 12.5) {
        return "clearsky_day";
    }


    if (cloud <= 37.5) {
        return "fair_day";
    }


    if (cloud <= 75) {
        return "partlycloudy_day";
    }


    return "cloudy";
}


/*
 * Choose the icon that represents the daytime weather.
 */
function representativeDaySymbol(
    entries: MetEntry[]
): string {

    /*
     * First: meaningful rain/snow/thunder during daytime.
     */
    const precipitationSymbol =
        daytimePrecipitationSymbol(
            entries
        );


    if (precipitationSymbol) {
        return precipitationSymbol;
    }


    /*
     * Otherwise: use actual instantaneous cloud cover
     * around noon.
     */
    const noon =
        closestToNoon(
            entries
        );


    return skySymbolFromNoon(
        noon
    );
}


/* ============================================================
   DAILY FORECAST BUILDER
   ============================================================ */

async function buildDays(
    timeseries: MetEntry[]
): Promise<WeatherDay[]> {

    const grouped =
        new Map<
            string,
            MetEntry[]
        >();


    for (const entry of timeseries) {

        const date =
            osloDateString(
                new Date(entry.time)
            );


        const entries =
            grouped.get(date)
            ??
            [];


        entries.push(entry);


        grouped.set(
            date,
            entries
        );
    }


    const dates =
        [...grouped.keys()]
            .sort()
            .slice(0, 7);


    const days:
        WeatherDay[] =
        [];


    for (const date of dates) {

        const entries =
            grouped.get(date)
            ??
            [];


        const temperatures =
            entries
                .map(
                    entry =>
                        entry
                            .data
                            .instant
                            .details
                            .air_temperature
                )
                .filter(
                    (
                        value
                    ): value is number =>
                        typeof value
                        ===
                        "number"
                );


        if (
            temperatures.length
            ===
            0
        ) {

            continue;
        }


        const maxTemp =
            Math.round(
                Math.max(
                    ...temperatures
                )
            );


        const minTemp =
            Math.round(
                Math.min(
                    ...temperatures
                )
            );


        const precipitationMm =
            dailyPrecipitation(
                entries
            );


        const symbolCode =
            representativeDaySymbol(
                entries
            );


        const iconSvg =
            await getMeteoconSvg(
                meteoconName(
                    symbolCode
                )
            );


        days.push({

            date,

            dayName:
                norwegianDay(
                    date
                ),

            weatherCode:
                symbolCode,

            weatherLabel:
                weatherLabel(
                    symbolCode
                ),

            iconSvg,

            maxTemp,

            minTemp,

            precipitationMm,

        });
    }


    return days;
}


/* ============================================================
   FETCH MET NORWAY
   ============================================================ */

async function fetchWeatherFromMet(): Promise<WeatherData> {

    console.log(
        "Weather: fetching fresh data from MET Norway"
    );


    const response =
        await fetch(
            MET_URL,
            {
                headers: {
                    "User-Agent":
                        MET_USER_AGENT,

                    "Accept":
                        "application/json",
                },
            }
        );


    if (!response.ok) {

        throw new Error(
            `MET Norway error: ${response.status}`
        );
    }


    const data =
        await response.json();


    const timeseries:
        MetEntry[] =
        data
            .properties
            .timeseries;


    if (
        !timeseries
        ||
        timeseries.length === 0
    ) {

        throw new Error(
            "MET Norway returned no forecast data"
        );
    }


    /* --------------------------------------------------------
       CURRENT CONDITIONS
       -------------------------------------------------------- */

    const current =
        timeseries[0];


    const currentTemperature =
        current
            .data
            .instant
            .details
            .air_temperature
        ??
        0;


    const windSpeed =
        current
            .data
            .instant
            .details
            .wind_speed
        ??
        0;


    const currentSymbol =
        current
            .data
            .next_1_hours
            ?.summary
            ?.symbol_code

        ??

        current
            .data
            .next_6_hours
            ?.summary
            ?.symbol_code

        ??

        current
            .data
            .next_12_hours
            ?.summary
            ?.symbol_code

        ??

        "cloudy";


    const currentIconSvg =
        await getMeteoconSvg(
            meteoconName(
                currentSymbol
            )
        );


    /* --------------------------------------------------------
       DAILY FORECAST
       -------------------------------------------------------- */

    const days =
        await buildDays(
            timeseries
        );


    if (
        days.length === 0
    ) {

        throw new Error(
            "Could not build daily forecast from MET Norway data"
        );
    }


    const weather:
        WeatherData =
    {

        location:
            "Kalbakken",

        current: {

            temperature:
                Math.round(
                    currentTemperature
                ),

            /*
             * MET compact does not directly provide
             * apparent temperature.
             *
             * Keep actual temperature here for now
             * so the current Weather.liquid continues
             * to work unchanged.
             */
            apparentTemperature:
                Math.round(
                    currentTemperature
                ),

            weatherCode:
                currentSymbol,

            weatherLabel:
                weatherLabel(
                    currentSymbol
                ),

            iconSvg:
                currentIconSvg,

            windSpeed:
                Math.round(
                    windSpeed
                ),

        },

        today:
            days[0],

        forecast:
            days.slice(
                1,
                6
            ),

    };


    /* --------------------------------------------------------
       MET CACHE EXPIRATION
       -------------------------------------------------------- */

    const expiresHeader =
        response
            .headers
            .get(
                "expires"
            );


    if (expiresHeader) {

        const expires =
            new Date(
                expiresHeader
            ).getTime();


        if (
            !Number.isNaN(
                expires
            )
        ) {

            cacheExpiresAt =
                expires;
        }
    }


    /*
     * Fallback if MET does not supply a useful Expires header.
     */
    if (
        !cacheExpiresAt
        ||
        cacheExpiresAt
        <=
        Date.now()
    ) {

        cacheExpiresAt =
            Date.now()
            +
            10 * 60 * 1000;
    }


    return weather;
}


/* ============================================================
   PUBLIC FUNCTION
   ============================================================ */

export async function getWeather(): Promise<WeatherData> {

    const now =
        Date.now();


    if (
        cachedWeather
        &&
        now < cacheExpiresAt
    ) {

        console.log(
            "Weather: using cached MET Norway data"
        );


        return cachedWeather;
    }


    if (
        weatherRequestInProgress
    ) {

        console.log(
            "Weather: waiting for existing MET Norway request"
        );


        return weatherRequestInProgress;
    }


    weatherRequestInProgress =
        (async () => {

            try {

                const weather =
                    await fetchWeatherFromMet();


                cachedWeather =
                    weather;


                console.log(
                    "Weather: fresh MET Norway data cached"
                );


                return weather;

            } catch (error) {

                console.error(
                    "Weather: MET Norway fetch failed",
                    error
                );


                if (cachedWeather) {

                    console.warn(
                        "Weather: using stale cached weather"
                    );


                    return cachedWeather;
                }


                throw error;

            } finally {

                weatherRequestInProgress =
                    null;
            }

        })();


    return weatherRequestInProgress;
}
