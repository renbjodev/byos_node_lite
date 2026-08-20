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

const METEOCONS_BASE =
    "https://cdn.meteocons.com/latest/svg-static/monochrome";

const iconCache = new Map<string, string>();

function weatherInfo(code: number): { label: string; icon: string } {
    if (code === 0) {
        return { label: "Klart", icon: "clear-day" };
    }

    if (code === 1) {
        return { label: "For det meste klart", icon: "partly-cloudy-day" };
    }

    if (code === 2) {
        return { label: "Delvis skyet", icon: "partly-cloudy-day" };
    }

    if (code === 3) {
        return { label: "Overskyet", icon: "overcast" };
    }

    if ([45, 48].includes(code)) {
        return { label: "Tåke", icon: "fog-day" };
    }

    if ([51, 53, 55, 56, 57].includes(code)) {
        return { label: "Yr", icon: "drizzle" };
    }

    if (code === 61) {
        return { label: "Lett regn", icon: "drizzle" };
    }

    if (code === 63) {
        return { label: "Regn", icon: "rain" };
    }

    if ([65, 66, 67].includes(code)) {
        return { label: "Kraftig regn", icon: "extreme-rain" };
    }

    if ([71, 73, 75, 77].includes(code)) {
        return { label: "Snø", icon: "snow" };
    }

    if (code === 80) {
        return { label: "Lette regnbyger", icon: "partly-cloudy-day-rain" };
    }

    if (code === 81) {
        return { label: "Regnbyger", icon: "rain" };
    }

    if (code === 82) {
        return { label: "Kraftige regnbyger", icon: "extreme-rain" };
    }

    if ([85, 86].includes(code)) {
        return { label: "Snøbyger", icon: "snow" };
    }

    if ([95, 96, 99].includes(code)) {
        return { label: "Torden", icon: "thunderstorms-day-rain" };
    }

    return { label: "Ukjent", icon: "overcast" };
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

    const date = new Date(dateString + "T12:00:00");

    return names[date.getDay()];
}

async function getMeteoconSvg(iconName: string): Promise<string> {
    const cached = iconCache.get(iconName);

    if (cached) {
        return cached;
    }

    const url = `${METEOCONS_BASE}/${iconName}.svg`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.error(
                `Failed to fetch Meteocon "${iconName}": ${response.status}`
            );

            if (iconName !== "overcast") {
                return getMeteoconSvg("overcast");
            }

            return "";
        }

        let svg = await response.text();

        // Make monochrome icons explicitly black.
        svg = svg.replaceAll("currentColor", "#000000");

        // Remove XML declarations if present.
        svg = svg.replace(/<\?xml[^>]*\?>/g, "");

        iconCache.set(iconName, svg);

        return svg;
    } catch (error) {
        console.error(
            `Failed to fetch Meteocon "${iconName}":`,
            error
        );

        if (iconName !== "overcast") {
            return getMeteoconSvg("overcast");
        }

        return "";
    }
}

export async function getWeather(): Promise<WeatherData> {
    const params = new URLSearchParams({
        latitude: LATITUDE.toString(),
        longitude: LONGITUDE.toString(),
        timezone: "Europe/Oslo",
        forecast_days: "7",
        wind_speed_unit: "ms",

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

    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    );

    if (!response.ok) {
        throw new Error(`Open-Meteo error: ${response.status}`);
    }

    const data = await response.json();

    const rawDays = data.daily.time.map(
        (date: string, index: number) => {
            const info = weatherInfo(
                data.daily.weather_code[index]
            );

            return {
                date,
                dayName: norwegianDay(date),
                weatherCode: data.daily.weather_code[index],
                weatherLabel: info.label,
                iconName: info.icon,

                maxTemp: Math.round(
                    data.daily.temperature_2m_max[index]
                ),

                minTemp: Math.round(
                    data.daily.temperature_2m_min[index]
                ),

                precipitationMm:
                    Math.round(
                        (
                            data.daily.precipitation_sum[index] ??
                            0
                        ) * 10
                    ) / 10,
            };
        }
    );

    const days: WeatherDay[] = await Promise.all(
        rawDays.map(async (day: any) => ({
            date: day.date,
            dayName: day.dayName,
            weatherCode: day.weatherCode,
            weatherLabel: day.weatherLabel,
            iconSvg: await getMeteoconSvg(day.iconName),
            maxTemp: day.maxTemp,
            minTemp: day.minTemp,
            precipitationMm: day.precipitationMm,
        }))
    );

    const currentInfo = weatherInfo(
        data.current.weather_code
    );

    const currentIconSvg =
        await getMeteoconSvg(currentInfo.icon);

    return {
        location: "Kalbakken",

        current: {
            temperature: Math.round(
                data.current.temperature_2m
            ),

            apparentTemperature: Math.round(
                data.current.apparent_temperature
            ),

            weatherCode: data.current.weather_code,
            weatherLabel: currentInfo.label,
            iconSvg: currentIconSvg,

            windSpeed: Math.round(
                data.current.wind_speed_10m
            ),
        },

        today: days[0],

        forecast: days.slice(1, 6),
    };
}
