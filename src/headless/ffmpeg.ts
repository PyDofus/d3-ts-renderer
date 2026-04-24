export type ExportFormat = 'webm' | 'mp4' | 'webp' | 'gif';

export interface FormatProfile {
    container: string;
    videoCodec: string;
    audioCodec: string | null;
    supportsAudio: boolean;
    supportsAlpha: boolean;
    videoArgs: string[];
    requiresEvenDims: boolean;
}

export const FORMATS: Record<ExportFormat, FormatProfile> = {
    webm: {
        container: 'webm',
        videoCodec: 'libvpx',
        audioCodec: 'libvorbis',
        supportsAudio: true,
        supportsAlpha: true,
        videoArgs: [
            '-pix_fmt', 'yuva420p',
            '-deadline', 'realtime',
            '-cpu-used', '8',
            '-b:v', '2M',
            '-auto-alt-ref', '0',
            '-threads', '0',
        ],
        requiresEvenDims: false,
    },

    mp4: {
        container: 'mp4',
        videoCodec: 'libx264',
        audioCodec: 'aac',
        supportsAudio: true,
        supportsAlpha: false,
        videoArgs: [
            '-pix_fmt', 'yuv420p',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-crf', '23',
            '-movflags', '+faststart',
            '-threads', '0',
        ],
        requiresEvenDims: true,
    },

    webp: {
        container: 'webp',
        videoCodec: 'libwebp',
        audioCodec: null,
        supportsAudio: false,
        supportsAlpha: true,
        videoArgs: [
            '-pix_fmt', 'yuv420p',
            '-loop', '0',
            '-compression_level', '0',
            '-quality', '75',
            '-preset', 'picture',
            '-threads', '0',
        ],
        requiresEvenDims: false,
    },

    gif: {
        container: 'gif',
        videoCodec: 'gif',
        audioCodec: null,
        supportsAudio: false,
        supportsAlpha: false,
        videoArgs: [
            '-pix_fmt', 'rgb8',
            '-gifflags', '+transdiff',
        ],
        requiresEvenDims: false,
    },
};
