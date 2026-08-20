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

/*
 * MET Norway requires an identifiable User-Agent.
 * A project/repository URL is fine as contact information.
 */
const MET_USER_AGENT =
    "KalbakkenKindleWeather/1.0 https://github.com/renbjodev/byos_node_lite";


/* ============================================================
   WEATHER CACHE
   ============================================================ */

let cachedWeather: WeatherData | null = null;
let cacheExpiresAt = 0;

let weatherRequestInProgress: Promise<WeatherData> | null = null;


/* ============================================================
   ICON CACHE
   ============================================================ */

const iconCache = new Map<string, string>();


/* ============================================================
   TIME HELPERS
   ============================================================ */

function osloDateString(date: Date): string {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Oslo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}


function osloHour(date: Date): number {
    return Number(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/Oslo",
            hour: "2-digit",
            hour12: false,
        }).format(date)
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

    const date =
        new Date(dateString + "T12:00:00+02:00");

    return names[date.getDay()];
}


/* ============================================================
   MET SYMBOL → LABEL
   ============================================================ */

function weatherLabel(symbolCode: string): string {

    const code =
        symbolCode
            .replace("_day", "")
            .replace("_night", "")
            .replace("_polartwilight", "");


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
        symbolCode
            .replace("_day", "")
            .replace("_night", "")
            .replace("_polartwilight", "");


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


    const iconPath = join(
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


        svg = svg.replaceAll(
            "currentColor",
            "#000000"
        );


        svg = svg.replace(
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
            `Failed to load Meteocon "${iconName}" from ${iconPath}`
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
   MET DATA TYPES
   ============================================================ */

type MetEntry = {
    time: string;

    data: {
        instant: {
            details: {
                air_temperature?: number;
                wind_speed?: number;
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
        };
    };
};


/* ============================================================
   DAILY FORECAST BUILDER
   ============================================================ */

async function buildDays(
    timeseries: MetEntry[]
): Promise<WeatherDay[]> {

    const grouped =
        new Map<string, MetEntry[]>();


    for (const entry of timeseries) {

        const date =
            osloDateString(
                new Date(entry.time)
            );


        const existing =
            grouped.get(date) ?? [];


        existing.push(entry);

        grouped.set(
            date,
            existing
        );
    }


    const dates =
        [...grouped.keys()]
            .sort()
            .slice(0, 7);


    const days: WeatherDay[] = [];


    for (const date of dates) {

        const entries =
            grouped.get(date) ?? [];


        const temperatures =
            entries
                .map(
                    entry =>
                        entry.data
                            .instant
                            .details
                            .air_temperature
                )
                .filter(
                    (
                        value
                    ): value is number =>
                        typeof value === "number"
                );


        if (temperatures.length === 0) {
            continue;
        }


        const maxTemp =
            Math.round(
                Math.max(...temperatures)
            );


        const minTemp =
            Math.round(
                Math.min(...temperatures)
            );


        /*
         * next_1_hours precipitation values can safely
         * be summed without overlapping forecast periods.
         */
        const precipitationMm =
            Math.round(
                entries.reduce(
                    (
                        total,
                        entry
                    ) =>
                        total +
                        (
                            entry.data
                                .next_1_hours
                                ?.details
                                ?.precipitation_amount
                            ?? 0
                        ),
                    0
                ) * 10
            ) / 10;


        /*
         * Pick the forecast entry closest to local noon
         * for the day's representative weather icon.
         */
        const noonEntry =
            [...entries]
                .sort(
                    (a, b) =>
                        Math.abs(
                            osloHour(
                                new Date(a.time)
                            ) - 12
                        )
                        -
                        Math.abs(
                            osloHour(
                                new Date(b.time)
                            ) - 12
                        )
                )[0];


        const symbolCode =
            noonEntry?.data
                .next_6_hours
                ?.summary
                ?.symbol_code
            ??
            noonEntry?.data
                .next_1_hours
                ?.summary
                ?.symbol_code
            ??
            "cloudy";


        const iconName =
            meteoconName(
                symbolCode
            );


        const iconSvg =
            await getMeteoconSvg(
                iconName
            );


        days.push({

            date,

            dayName:
                norwegianDay(date),

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


    const timeseries: MetEntry[] =
        data.properties.timeseries;


    if (
        !timeseries ||
        timeseries.length === 0
    ) {

        throw new Error(
            "MET Norway returned no forecast data"
        );
    }


    const now =
        timeseries[0];


    const currentTemperature =
        now.data
            .instant
            .details
            .air_temperature
        ?? 0;


    const windSpeed =
        now.data
            .instant
            .details
            .wind_speed
        ?? 0;


    const currentSymbol =
        now.data
            .next_1_hours
            ?.summary
            ?.symbol_code
        ??
        now.data
            .next_6_hours
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


    const days =
        await buildDays(
            timeseries
        );


    if (days.length === 0) {

        throw new Error(
            "Could not build daily forecast from MET Norway data"
        );
    }


    /*
     * MET compact does not include "feels like" directly.
     * For now we use the actual temperature there so the
     * existing layout does not need to change.
     */
    const weather: WeatherData = {

        location:
            "Kalbakken",

        current: {

            temperature:
                Math.round(
                    currentTemperature
                ),

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
            days.slice(1, 6),

    };


    /*
     * MET explicitly tells clients when the data expires.
     */
    const expiresHeader =
        response.headers.get(
            "expires"
        );


    if (expiresHeader) {

        const expires =
            new Date(
                expiresHeader
            ).getTime();


        if (!Number.isNaN(expires)) {
            cacheExpiresAt =
                expires;
        }
    }


    /*
     * Safety fallback if Expires is unavailable.
     */
    if (
        !cacheExpiresAt ||
        cacheExpiresAt <= Date.now()
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
        cachedWeather &&
        now < cacheExpiresAt
    ) {

        console.log(
            "Weather: using cached MET Norway data"
        );


        return cachedWeather;
    }


    if (weatherRequestInProgress) {

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
