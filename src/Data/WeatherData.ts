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


const LATITUDE = 59.9512;
const LONGITUDE = 10.8678;


/* ============================================================
   WEATHER CACHE
   ============================================================ */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cachedWeather: WeatherData | null = null;
let cachedAt = 0;

/*
 * Prevent several simultaneous /image requests from each
 * starting their own Open-Meteo request.
 */
let weatherRequestInProgress: Promise<WeatherData> | null = null;


/* ============================================================
   METEOCONS CACHE
   ============================================================ */

const iconCache = new Map<string, string>();


/* ============================================================
   WEATHER CODE MAPPING
   ============================================================ */

function weatherInfo(
    code: number
): { label: string; icon: string } {

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
            icon: "overcast-day",
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
            icon: "extreme-drizzle",
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
            icon: "overcast-rain",
        };
    }

    if (code === 82) {
        return {
            label: "Kraftige regnbyger",
            icon: "extreme-day-rain",
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
            icon: "extreme-day-snow",
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

    const date = new Date(
        dateString + "T12:00:00"
    );

    return names[date.getDay()];
}


/* ============================================================
   LOCAL METEOCONS
   ============================================================ */

async function getMeteoconSvg(
    iconName: string
): Promise<string> {

    const cached = iconCache.get(iconName);

    if (cached) {
        return cached;
    }

    /*
     * The package is installed by npm inside node_modules.
     * Reading it directly avoids CDN/browser loading entirely.
     */
    const iconPath = join(
        process.cwd(),
        "node_modules",
        "@meteocons",
        "svg-static",
        "monochrome",
        `${iconName}.svg`
    );

    try {

        let svg = await readFile(
            iconPath,
            "utf8"
        );

        /*
         * Force monochrome icons to solid black.
         */
        svg = svg.replaceAll(
            "currentColor",
            "#000000"
        );

        /*
         * Strip optional XML declaration.
         */
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

        /*
         * Fall back to a simple cloud if an icon name
         * does not exist in the package.
         */
        if (iconName !== "overcast") {
            return getMeteoconSvg("overcast");
        }

        console.error(
            "Could not load Meteocons fallback icon either.",
            error
        );

        return "";
    }
}


/* ============================================================
   OPEN-METEO REQUEST
   ============================================================ */

async function fetchWeatherFromOpenMeteo(): Promise<WeatherData> {

    const params = new URLSearchParams({

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
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`;


    console.log(
        "Weather: fetching fresh data from Open-Meteo"
    );


    const response = await fetch(url);


    if (!response.ok) {

        throw new Error(
            `Open-Meteo error: ${response.status}`
        );

    }


    const data = await response.json();


    /* --------------------------------------------------------
       DAILY WEATHER
       -------------------------------------------------------- */

    const rawDays = data.daily.time.map(
        (
            date: string,
            index: number
        ) => {

            const weatherCode =
                data.daily.weather_code[index];

            const info =
                weatherInfo(weatherCode);


            return {

                date,

                dayName:
                    norwegianDay(date),

                weatherCode,

                weatherLabel:
                    info.label,

                iconName:
                    info.icon,

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
    );


    const days: WeatherDay[] =
        await Promise.all(

            rawDays.map(
                async (day: any) => ({

                    date:
                        day.date,

                    dayName:
                        day.dayName,

                    weatherCode:
                        day.weatherCode,

                    weatherLabel:
                        day.weatherLabel,

                    iconSvg:
                        await getMeteoconSvg(
                            day.iconName
                        ),

                    maxTemp:
                        day.maxTemp,

                    minTemp:
                        day.minTemp,

                    precipitationMm:
                        day.precipitationMm,

                })
            )

        );


    /* --------------------------------------------------------
       CURRENT WEATHER
       -------------------------------------------------------- */

    const currentCode =
        data.current.weather_code;


    const currentInfo =
        weatherInfo(currentCode);


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
                    data.current.temperature_2m
                ),

            apparentTemperature:
                Math.round(
                    data.current.apparent_temperature
                ),

            weatherCode:
                currentCode,

            weatherLabel:
                currentInfo.label,

            iconSvg:
                currentIconSvg,

            windSpeed:
                Math.round(
                    data.current.wind_speed_10m
                ),

        },

        today:
            days[0],

        forecast:
            days.slice(1, 6),

    };
}


/* ============================================================
   PUBLIC WEATHER FUNCTION
   ============================================================ */

export async function getWeather(): Promise<WeatherData> {

    const now = Date.now();


    /*
     * Cache is still fresh.
     */
    if (
        cachedWeather &&
        now - cachedAt < CACHE_TTL_MS
    ) {

        console.log(
            "Weather: using cached data"
        );

        return cachedWeather;

    }


    /*
     * Another request is already fetching weather.
     * Reuse that request rather than calling Open-Meteo again.
     */
    if (weatherRequestInProgress) {

        console.log(
            "Weather: waiting for existing weather request"
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
                    "Weather: fresh data cached"
                );


                return weather;

            } catch (error) {

                console.error(
                    "Weather: fresh fetch failed",
                    error
                );


                /*
                 * If Open-Meteo temporarily rate-limits us,
                 * continue showing the last successful forecast.
                 */
                if (cachedWeather) {

                    console.warn(
                        "Weather: using stale cached data"
                    );

                    return cachedWeather;

                }


                /*
                 * No previous successful response exists.
                 * We cannot create a meaningful weather screen.
                 */
                throw error;

            } finally {

                weatherRequestInProgress =
                    null;

            }

        })();


    return weatherRequestInProgress;
}
