import express, {
    NextFunction,
    Request,
    Response
} from "express";

import {
    SECRET_KEY,
    SERVER_HOST,
    SERVER_PORT,
    BYOS_ENABLED,
    REFRESH_RATE_SECONDS,
    SCREEN_URL,
    IS_TEST_ENV
} from "Config.js";

import {
    buildPreviewScreen,
    getLiveScreen,
    getScreenHash
} from "Screen/Screen.js";

import {
    BYOSRoutes
} from "BYOS/BYOSRoutes.js";

import {
    ROUTE_IMAGE,
    ROUTE_LIVE_IMAGE,
    ROUTE_PLUGIN_REDIRECT
} from "Routes.js";

import {
    initPuppeteer
} from "./Screen/RenderHTML.js";


export const app =
    express();


app.use(
    express.json()
);


// ============================================================
// BYOS
// ============================================================

if (BYOS_ENABLED) {

    app.use(
        '/api',
        BYOSRoutes
    );
}


// ============================================================
// HEALTH
// ============================================================

app.get(
    '/',
    (
        _req: Request,
        res: Response
    ) => {

        /*
         * Simple health check.
         *
         * NO weather.
         * NO Puppeteer render.
         */
        res
            .status(200)
            .send('OK');
    }
);


// ============================================================
// SECRET KEY
// ============================================================

function isSecretKeyValid(
    req: Request,
    res: Response
): boolean {

    if (
        req.query['secret_key']
        !==
        SECRET_KEY
    ) {

        res.setHeader(
            'Content-Type',
            'application/json'
        );

        res
            .status(401)
            .json(
                'Wrong or missing secret_key'
            );

        return false;
    }

    return true;
}


// ============================================================
// PLUGIN REDIRECT
// ============================================================

app.get(
    ROUTE_PLUGIN_REDIRECT,
    async (
        req: Request,
        res: Response
    ) => {

        if (
            !isSecretKeyValid(
                req,
                res
            )
        ) {
            return;
        }

        res.setHeader(
            'Content-Type',
            'application/json'
        );

        res.json({

            filename:
                'custom-screen-'
                +
                await getScreenHash(),

            url:
                SCREEN_URL,

            refresh_rate:
                REFRESH_RATE_SECONDS,

        });
    }
);


// ============================================================
// BROWSER PREVIEW
// ============================================================

/*
 * /image
 *
 * Static example data only.
 *
 * You can refresh this as much as you want while editing
 * Weather.liquid.
 *
 * It NEVER contacts Open-Meteo.
 */
app.get(
    ROUTE_IMAGE,
    async (
        req: Request,
        res: Response
    ) => {

        if (
            !isSecretKeyValid(
                req,
                res
            )
        ) {
            return;
        }

        const image =
            await buildPreviewScreen();

        res.setHeader(
            'Content-Type',
            'image/png'
        );

        res.send(
            image
        );
    }
);


// ============================================================
// KINDLE LIVE IMAGE
// ============================================================

/*
 * /live-image
 *
 * This does NOT refresh weather.
 *
 * The live weather refresh happens when BYOS requests
 * the screen hash / metadata.
 *
 * This endpoint only serves the already-generated
 * live image, or a safe preview fallback.
 */
app.get(
    ROUTE_LIVE_IMAGE,
    async (
        req: Request,
        res: Response
    ) => {

        if (
            !isSecretKeyValid(
                req,
                res
            )
        ) {
            return;
        }

        const image =
            await getLiveScreen();

        res.setHeader(
            'Content-Type',
            'image/png'
        );

        res.send(
            image
        );
    }
);


// ============================================================
// 404
// ============================================================

app.use(
    (
        req: Request,
        res: Response
    ) => {

        console.log(
            `[404] ${req.method} ${req.url}`
        );

        res
            .status(404)
            .json({
                error:
                    'Not Found',

                message:
                    'The requested path could not be found: '
                    +
                    req.url
            });
    }
);


// ============================================================
// ERRORS
// ============================================================

app.use(
    (
        err: Error,
        _req: Request,
        res: Response,
        _next: NextFunction
    ) => {

        console.error(
            err.stack
        );

        res
            .status(500)
            .json({
                error:
                    'Internal Server Error',

                message:
                    'Something went wrong!'
            });
    }
);


// ============================================================
// START
// ============================================================

if (!IS_TEST_ENV) {

    app.listen(
        SERVER_PORT,
        SERVER_HOST,
        async (
            error
        ) => {

            if (error) {
                throw error;
            }

            await initPuppeteer();

            console.log(
                'Server started.'
            );

            console.log(
                `Preview: http://127.0.0.1:${SERVER_PORT}${ROUTE_IMAGE}?secret_key=...`
            );

            console.log(
                `Live image: ${SCREEN_URL}`
            );

            /*
             * IMPORTANT:
             *
             * No checkImageUrl(SCREEN_URL) here.
             *
             * Starting or redeploying Render therefore
             * causes zero weather requests.
             */
        }
    );
}
