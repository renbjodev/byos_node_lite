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


/* ============================================================
   LOCATION
   ============================================================ */

const LATITUDE = 59.9512;
const LONGITUDE = 10.8678;


/* ============================================================
   CACHE
   ============================================================ */

const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedWeather: WeatherData | null = null;
let cachedAt = 0;

let weatherRequestInProgress: Promise<WeatherData> | null = null;

const iconCache = new Map<string, string>();


/* ============================================================
   OPEN-METEO → LABEL + ICON
   ============================================================ */

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

    if ([51, 53, 55].includes(code)) {
        return {
            label: "Yr",
            icon: "drizzle",
        };
    }

    if ([56, 57].includes(code)) {
        return {
            label: "Underkjølt yr",
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

    if ([71, 73].includes(code)) {
        return {
            label: "Snø",
            icon: "snow",
        };
    }

    if ([75, 77].includes(code)) {
        return {
            label: "Kraftig snø",
            icon: "extreme-snow",
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

    if (code === 85) {
        return {
            label: "Snøbyger",
            icon: "partly-cloudy-day-snow",
        };
    }

    if (code === 86) {
        return {
            label: "Kraftige snøbyger",
            icon: "extreme-snow",
        };
    }

    if (code === 95) {
        return {
            label: "Torden",
            icon: "thunderstorms-day",
        };
    }

    if ([96, 99].includes(code)) {
        return {
            label: "Torden og regn",
            icon: "thunderstorms-day-rain",
        };
    }

    return {
        label: "Ukjent",
        icon: "overcast",
    };
}


/* ============================================================
   DAY NAMES
   ============================================================ */

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
            dateString + "T12:00:00"
        );

    return names[
        date.getDay()
    ];
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
   FETCH OPEN-METEO
   ============================================================ */

async function fetchWeatherFromOpenMeteo(): Promise<WeatherData> {

    console.log(
        "Weather: fetching fresh data from Open-Meteo"
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


    const response =
        await fetch(
            `https://api.open-meteo.com/v1/forecast?${params.toString()}`
        );


    if (!response.ok) {

        throw new Error(
            `Open-Meteo error: ${response.status}`
        );
    }


    const data =
        await response.json();


    /* --------------------------------------------------------
       DAILY FORECAST
       -------------------------------------------------------- */

    const days:
        WeatherDay[] =
        await Promise.all(

            data.daily.time.map(
                async (
                    date: string,
                    index: number
                ) => {

                    const weatherCode =
                        data.daily
                            .weather_code[index];


                    const info =
                        weatherInfo(
                            weatherCode
                        );


                    const iconSvg =
                        await getMeteoconSvg(
                            info.icon
                        );


                    return {

                        date,

                        dayName:
                            norwegianDay(
                                date
                            ),

                        weatherCode,

                        weatherLabel:
                            info.label,

                        iconSvg,

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
                                ) * 10
                            ) / 10,

                    };
                }
            )

        );


    /* --------------------------------------------------------
       CURRENT WEATHER
       -------------------------------------------------------- */

    const currentCode =
        data.current
            .weather_code;


    const currentInfo =
        weatherInfo(
            currentCode
        );


    const currentIconSvg =
        await getMeteoconSvg(
            currentInfo.icon
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
                currentIconSvg,

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


/* ============================================================
   PUBLIC FUNCTION + CACHE
   ============================================================ */

export async function getWeather(): Promise<WeatherData> {

    const now =
        Date.now();


    /*
     * Fresh cache.
     */
    if (
        cachedWeather
        &&
        now - cachedAt
        <
        CACHE_TTL_MS
    ) {

        console.log(
            "Weather: using cached Open-Meteo data"
        );


        return cachedWeather;
    }


    /*
     * Prevent duplicate simultaneous requests.
     */
    if (
        weatherRequestInProgress
    ) {

        console.log(
            "Weather: waiting for existing Open-Meteo request"
        );


        return weatherRequestInProgress;
    }


    weatherRequestInProgress =
        (async () => {

            try {

                const weather =
                    await fetchWeatherFromOpenMeteo();


                cachedWeather =
                    weather;

                cachedAt =
                    Date.now();


                console.log(
                    "Weather: fresh Open-Meteo data cached"
                );


                return weather;

            } catch (error) {

                console.error(
                    "Weather: Open-Meteo fetch failed",
                    error
                );


                /*
                 * If Open-Meteo temporarily fails
                 * but we have old data, keep showing it.
                 */
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
