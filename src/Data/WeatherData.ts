import { readFile } from "node:fs/promises";
import { join } from "node:path";


export type WeatherDay = {
    date: string;
    dayName: string;

    weatherCode: number;
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

        weatherCode: number;
        weatherLabel: string;

        iconSvg: string;

        windSpeed: number;
    };

    today: WeatherDay;

    forecast: WeatherDay[];
};


// ============================================================
// LOCATION
// ============================================================

const LATITUDE = 59.9512;
const LONGITUDE = 10.8678;


// ============================================================
// CACHE
// ============================================================

const CACHE_TTL_MS =
    10 * 60 * 1000;

let cachedWeather:
    WeatherData | null =
    null;

let cachedAt = 0;

let requestInProgress:
    Promise<WeatherData> | null =
    null;


// ============================================================
// ICON CACHE
// ============================================================

const iconCache =
    new Map<string, string>();


// ============================================================
// OPEN-METEO CODE MAPPING
// ============================================================

function weatherInfo(
    code: number
): {
    label: string;
    icon: string;
} {

    if (code === 0) {
        return {
            label: "Klart",
            icon: "clear-day",
        };
    }

    if (code === 1) {
        return {
            label: "For det meste klart",
            icon: "partly-cloudy-day",
        };
    }

    if (code === 2) {
        return {
            label: "Delvis skyet",
            icon: "partly-cloudy-day",
        };
    }

    if (code === 3) {
        return {
            label: "Overskyet",
            icon: "overcast",
        };
    }

    if ([45, 48].includes(code)) {
        return {
            label: "Tåke",
            icon: "fog-day",
        };
    }

    if ([51, 53, 55, 56, 57].includes(code)) {
        return {
            label: "Yr",
            icon: "drizzle",
        };
    }

    if (code === 61) {
        return {
            label: "Lett regn",
            icon: "drizzle",
        };
    }

    if (code === 63) {
        return {
            label: "Regn",
            icon: "rain",
        };
    }

    if ([65, 66, 67].includes(code)) {
        return {
            label: "Kraftig regn",
            icon: "extreme-rain",
        };
    }

    if ([71, 73, 75, 77].includes(code)) {
        return {
            label: "Snø",
            icon: "snow",
        };
    }

    if (code === 80) {
        return {
            label: "Lette regnbyger",
            icon: "partly-cloudy-day-rain",
        };
    }

    if (code === 81) {
        return {
            label: "Regnbyger",
            icon: "rain",
        };
    }

    if (code === 82) {
        return {
            label: "Kraftige regnbyger",
            icon: "extreme-rain",
        };
    }

    if ([85, 86].includes(code)) {
        return {
            label: "Snøbyger",
            icon: "snow",
        };
    }

    if ([95, 96, 99].includes(code)) {
        return {
            label: "Torden",
            icon: "thunderstorms-day-rain",
        };
    }

    return {
        label: "Ukjent",
        icon: "overcast",
    };
}


// ============================================================
// DAY NAME
// ============================================================

function norwegianDay(
    dateString: string
): string {

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
        new Date(
            dateString
            + "T12:00:00"
        );

    return names[
        date.getDay()
    ];
}


// ============================================================
// LOCAL METEOCONS
// ============================================================

async function getMeteoconSvg(
    iconName: string
): Promise<string> {

    const cached =
        iconCache.get(
            iconName
        );

    if (cached) {
        return cached;
    }


    const path =
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
                path,
                "utf8"
            );


        /*
         * Force monochrome SVG to true black.
         */
        svg =
            svg.replaceAll(
                "currentColor",
                "#000000"
            );


        /*
         * Remove optional XML declaration.
         */
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
            `Failed to load weather icon "${iconName}"`
        );


        /*
         * Known-safe fallback.
         */
        if (
            iconName
            !==
            "overcast"
        ) {

            return getMeteoconSvg(
                "overcast"
            );
        }


        console.error(
            "Could not load fallback weather icon.",
            error
        );


        return "";
    }
}


// ============================================================
// OPEN-METEO
// ============================================================

async function fetchWeather():
Promise<WeatherData> {

    console.log(
        "Weather: requesting Open-Meteo"
    );


    const params =
        new URLSearchParams({

            latitude:
                LATITUDE.toString(),

            longitude:
                LONGITUDE.toString(),

            timezone:
                "Europe/Oslo",

            forecast_days:
                "7",

            wind_speed_unit:
                "ms",

            current: [
                "temperature_2m",
                "apparent_temperature",
                "weather_code",
                "wind_speed_10m",
            ].join(","),

            daily: [
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_sum",
            ].join(","),

        });


    const url =
        "https://api.open-meteo.com/v1/forecast?"
        + params.toString();


    const response =
        await fetch(url);


    if (!response.ok) {

        throw new Error(
            `Open-Meteo error: ${response.status}`
        );
    }


    const data =
        await response.json();


    // --------------------------------------------------------
    // Daily forecast
    // --------------------------------------------------------

    const days:
        WeatherDay[] =
        await Promise.all(

            data.daily.time.map(
                async (
                    date: string,
                    index: number
                ) => {

                    const code =
                        data.daily
                            .weather_code[index];


                    const info =
                        weatherInfo(code);


                    return {

                        date,

                        dayName:
                            norwegianDay(
                                date
                            ),

                        weatherCode:
                            code,

                        weatherLabel:
                            info.label,

                        iconSvg:
                            await getMeteoconSvg(
                                info.icon
                            ),

                        maxTemp:
                            Math.round(
                                data.daily
                                    .temperature_2m_max[index]
                            ),

                        minTemp:
                            Math.round(
                                data.daily
                                    .temperature_2m_min[index]
                            ),

                        precipitationMm:
                            Math.round(
                                (
                                    data.daily
                                        .precipitation_sum[index]
                                    ?? 0
                                )
                                * 10
                            )
                            / 10,

                    };
                }
            )
        );


    // --------------------------------------------------------
    // Current
    // --------------------------------------------------------

    const currentCode =
        data.current
            .weather_code;


    const currentInfo =
        weatherInfo(
            currentCode
        );


    return {

        location:
            "Kalbakken",

        current: {

            temperature:
                Math.round(
                    data.current
                        .temperature_2m
                ),

            apparentTemperature:
                Math.round(
                    data.current
                        .apparent_temperature
                ),

            weatherCode:
                currentCode,

            weatherLabel:
                currentInfo.label,

            iconSvg:
                await getMeteoconSvg(
                    currentInfo.icon
                ),

            windSpeed:
                Math.round(
                    data.current
                        .wind_speed_10m
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
}


// ============================================================
// PUBLIC LIVE DATA
// ============================================================

export async function getWeather():
Promise<WeatherData> {

    const now =
        Date.now();


    /*
     * Normal Kindle refreshes within 10 minutes
     * use the cache.
     */
    if (
        cachedWeather
        &&
        now - cachedAt
        <
        CACHE_TTL_MS
    ) {

        console.log(
            "Weather: using cached data"
        );

        return cachedWeather;
    }


    /*
     * Do not allow parallel requests to hammer
     * Open-Meteo.
     */
    if (requestInProgress) {

        return requestInProgress;
    }


    requestInProgress =
        (async () => {

            try {

                const weather =
                    await fetchWeather();


                cachedWeather =
                    weather;

                cachedAt =
                    Date.now();


                console.log(
                    "Weather: live data updated"
                );


                return weather;

            } finally {

                requestInProgress =
                    null;
            }

        })();


    return requestInProgress;
}


// ============================================================
// STATIC PREVIEW DATA
// ============================================================

/*
 * This is ONLY used by /image in your browser.
 *
 * It never contacts Open-Meteo.
 */
export async function getPreviewWeather():
Promise<WeatherData> {

    const [
        clear,
        partly,
        overcast,
        rain,
        showers,
        drizzle
    ] =
        await Promise.all([

            getMeteoconSvg(
                "clear-day"
            ),

            getMeteoconSvg(
                "partly-cloudy-day"
            ),

            getMeteoconSvg(
                "overcast"
            ),

            getMeteoconSvg(
                "rain"
            ),

            getMeteoconSvg(
                "partly-cloudy-day-rain"
            ),

            getMeteoconSvg(
                "drizzle"
            ),

        ]);


    return {

        location:
            "Kalbakken",

        current: {

            temperature:
                15,

            apparentTemperature:
                15,

            weatherCode:
                0,

            weatherLabel:
                "Klart",

            iconSvg:
                clear,

            windSpeed:
                2,

        },


        today: {

            date:
                "2026-08-20",

            dayName:
                "TOR",

            weatherCode:
                0,

            weatherLabel:
                "Klart",

            iconSvg:
                clear,

            maxTemp:
                21,

            minTemp:
                9,

            precipitationMm:
                0,

        },


        forecast: [

            {
                date:
                    "2026-08-21",

                dayName:
                    "FRE",

                weatherCode:
                    1,

                weatherLabel:
                    "For det meste klart",

                iconSvg:
                    partly,

                maxTemp:
                    20,

                minTemp:
                    10,

                precipitationMm:
                    0,
            },


            {
                date:
                    "2026-08-22",

                dayName:
                    "LØR",

                weatherCode:
                    2,

                weatherLabel:
                    "Delvis skyet",

                iconSvg:
                    overcast,

                maxTemp:
                    18,

                minTemp:
                    11,

                precipitationMm:
                    0.7,
            },


            {
                date:
                    "2026-08-23",

                dayName:
                    "SØN",

                weatherCode:
                    80,

                weatherLabel:
                    "Regnbyger",

                iconSvg:
                    showers,

                maxTemp:
                    17,

                minTemp:
                    10,

                precipitationMm:
                    3.2,
            },


            {
                date:
                    "2026-08-24",

                dayName:
                    "MAN",

                weatherCode:
                    63,

                weatherLabel:
                    "Regn",

                iconSvg:
                    rain,

                maxTemp:
                    16,

                minTemp:
                    9,

                precipitationMm:
                    6.8,
            },


            {
                date:
                    "2026-08-25",

                dayName:
                    "TIR",

                weatherCode:
                    61,

                weatherLabel:
                    "Lett regn",

                iconSvg:
                    drizzle,

                maxTemp:
                    18,

                minTemp:
                    10,

                precipitationMm:
                    1.4,
            },

        ],
    };
}
