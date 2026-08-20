import {Jimp} from "jimp";


export async function PNGto1BIT(image: Buffer) {
    // Convert to grayscale
    const jimpImage = await Jimp.read(image);
    jimpImage.greyscale();
    const bit4Data = new Uint8Array(jimpImage.bitmap.data);

    // Convert to 1-bit
    let data = new Uint8Array(jimpImage.bitmap.width * jimpImage.bitmap.height);
    for (let i = 0; i < data.length; i++) {
        data[i] = bit4Data[i * 4];
    }

    // Use the actual rendered image dimensions
    const targetWidth = jimpImage.bitmap.width;
    const targetHeight = jimpImage.bitmap.height;
    const targetPixelCount = targetWidth * targetHeight;

    // BMP layout
    const bitsPerPixel = 1;
    const rowSize = Math.floor((targetWidth * bitsPerPixel + 31) / 32) * 4;

    const fileHeaderSize = 14;
    const infoHeaderSize = 40;
    const paletteSize = 8;

    const DISPLAY_BMP_IMAGE_SIZE =
        fileHeaderSize +
        infoHeaderSize +
        paletteSize +
        rowSize * targetHeight;

    // Step 2: Process the grayscale image
    const grayscale = new Uint8Array(targetPixelCount);
    const isEdge = new Uint8Array(targetPixelCount);

    // First, copy grayscale data
    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const i = y * targetWidth + x;
            grayscale[i] = data[i];
        }
    }

    // Step 3: Edge detection
    for (let y = 0; y < targetHeight; y++) {
        const yOffset = y * targetWidth;

        for (let x = 0; x < targetWidth; x++) {
            const idx = yOffset + x;
            const gray = grayscale[idx];

            // Edge detection for pixels not on the border
            if (y > 0 && y < targetHeight - 1 && x > 0 && x < targetWidth - 1) {
                // Check if this pixel has high contrast with neighbors
                const fuzziness = 20;
                const hasExtreme =
                    gray < fuzziness ||
                    gray > 255 - fuzziness ||
                    grayscale[idx - 1] < fuzziness ||
                    grayscale[idx - 1] > 255 - fuzziness ||
                    grayscale[idx + 1] < fuzziness ||
                    grayscale[idx + 1] > 255 - fuzziness ||
                    grayscale[idx - targetWidth] < fuzziness ||
                    grayscale[idx - targetWidth] > 255 - fuzziness ||
                    grayscale[idx + targetWidth] < fuzziness ||
                    grayscale[idx + targetWidth] > 255 - fuzziness;

                isEdge[idx] = hasExtreme ? 1 : 0;
            }
        }
    }

    // Step 4: Apply dithering method
    const dithered = atkinsonDithering(grayscale, targetWidth, targetHeight, false);

    // BMP file header (14 bytes) + Info header (40 bytes)
    const fileSize = DISPLAY_BMP_IMAGE_SIZE; // Exactly match the expected size

    // Create a buffer of exactly the required size
    const buffer = Buffer.alloc(fileSize);

    // BMP File Header - matching firmware expectations
    buffer.write("BM", 0); // Signature
    buffer.writeUInt32LE(fileSize, 2); // File Size
    buffer.writeUInt32LE(0, 6); // Reserved
    buffer.writeUInt32LE(fileHeaderSize + infoHeaderSize + paletteSize, 10); // Pixel data offset

    // BMP Info Header - matching firmware expectations
    buffer.writeUInt32LE(infoHeaderSize, 14); // Info Header Size
    buffer.writeInt32LE(targetWidth, 18); // Width
    buffer.writeInt32LE(targetHeight, 22); // Height
    buffer.writeUInt16LE(1, 26); // Planes
    buffer.writeUInt16LE(bitsPerPixel, 28); // Bits per pixel (1-bit)
    buffer.writeUInt32LE(0, 30); // Compression
    buffer.writeUInt32LE(rowSize * targetHeight, 34); // Image Size
    buffer.writeInt32LE(0, 38); // X pixels per meter
    buffer.writeInt32LE(0, 42); // Y pixels per meter
    buffer.writeUInt32LE(2, 46); // Total Colors (2 for monochrome)
    buffer.writeUInt32LE(2, 50); // Important Colors

    // Color Palette (2 colors: black and white)
    const paletteOffset = fileHeaderSize + infoHeaderSize;
    buffer.writeUInt32LE(0x00ffffff, paletteOffset); // White
    buffer.writeUInt32LE(0x00000000, paletteOffset + 4); // Black

    // Step 5: Generate the final bitmap
    const dataOffset = fileHeaderSize + infoHeaderSize + paletteSize;

    // Process 8 pixels at a time where possible
    for (let y = 0; y < targetHeight; y++) {
        // BMP is stored bottom-up, so we need to flip the y-coordinate
        const targetY = targetHeight - 1 - y;
        const yOffset = targetY * targetWidth;
        const destRowOffset = dataOffset + y * rowSize;

        // Process 8 pixels at a time
        for (let x = 0; x < targetWidth; x += 8) {
            let byte = 0;
            const remainingPixels = Math.min(8, targetWidth - x);

            // Process each bit in the byte
            for (let bit = 0; bit < remainingPixels; bit++) {
                const pixelX = x + bit;
                const idx = yOffset + pixelX;
                const gray = grayscale[idx];

                // Determine pixel value with optimized logic
                let isBlack = false;

                if (gray < 10) {
                    // Pure black pixel
                    isBlack = true;
                } else if (gray > 240) {
                    // Pure white pixel
                    isBlack = false;
                } else if (isEdge[idx]) {
                    // On an edge (likely text) - round to black for better contrast
                    isBlack = gray < 128;
                } else {
                    // Not on an edge (likely in an image) - use dithered result
                    const ditheredValue = dithered[idx];
                    isBlack = ditheredValue < 128; // Values are either 0 or 255
                }

                // Set the bit in the byte if black using bit operations
                if (isBlack) {
                    byte |= 1 << (7 - bit);
                }
            }

            // Write the byte to the buffer
            buffer[destRowOffset + (x >> 3)] = byte; // x / 8 using bit shift
        }
    }
    return buffer;
}


const atkinsonDithering = (
    grayscale: Uint8Array,
    width: number,
    height: number,
    inverted: boolean = false,
): Uint8Array => {
    // Create a copy of the grayscale array to avoid modifying the original
    const result = new Uint8Array(grayscale.length);
    const buffer = new Float32Array(grayscale.length);

    // Initialize buffer with grayscale values
    for (let i = 0; i < grayscale.length; i++) {
        buffer[i] = grayscale[i];
    }

    // Apply Atkinson dithering
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            const oldPixel = buffer[index];
            const newPixel = oldPixel < 128 ? 0 : 255;
            result[index] = inverted ? 255 - newPixel : newPixel;
            const error = Math.floor((oldPixel - newPixel) / 8);

            if (x + 1 < width) buffer[index + 1] += error;
            if (x + 2 < width) buffer[index + 2] += error;
            if (y + 1 < height && x - 1 >= 0) buffer[index + width - 1] += error;
            if (y + 1 < height) buffer[index + width] += error;
            if (y + 1 < height && x + 1 < width) buffer[index + width + 1] += error;
            if (y + 2 < height) buffer[index + width * 2] += error;
        }
    }

    return result;
};
