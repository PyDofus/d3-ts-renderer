export type ExportFormat = 'webm' | 'mp4' | 'webp' | 'gif';
export type HwAccel = 'none' | 'nvenc' | 'vaapi' | 'videotoolbox';

export interface GpuVideoProfile {
    videoCodec: string;
    videoArgs: string[];
    /** Extra filter stages appended to the CPU filter chain (e.g. VAAPI's format=nv12,hwupload). */
    extraFilters?: string[];
}

export interface FormatProfile {
    container: string;
    videoCodec: string;
    audioCodec: string | null;
    supportsAudio: boolean;
    supportsAlpha: boolean;
    videoArgs: string[];
    requiresEvenDims: boolean;
    /** Optional GPU-encoder variants. Formats without a viable hardware encoder (webm/webp/gif) omit this. */
    gpu?: Partial<Record<HwAccel, GpuVideoProfile>>;
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
        // No consumer GPU encoder does VP8/VP9 + alpha — stays CPU always.
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
        gpu: {
            nvenc: {
                videoCodec: 'h264_nvenc',
                videoArgs: [
                    '-pix_fmt', 'yuv420p',
                    '-rc', 'vbr',
                    '-cq', '23',
                    '-b:v', '0',
                    '-preset', 'p4',
                    '-movflags', '+faststart',
                ],
            },
            vaapi: {
                videoCodec: 'h264_vaapi',
                videoArgs: [
                    '-qp', '23',
                    '-movflags', '+faststart',
                ],
                extraFilters: ['format=nv12', 'hwupload'],
            },
            videotoolbox: {
                videoCodec: 'h264_videotoolbox',
                videoArgs: [
                    '-pix_fmt', 'yuv420p',
                    '-b:v', '4M',
                    '-movflags', '+faststart',
                ],
            },
        },
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
        // No GPU webp encoder exists — stays CPU always.
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
        // GIF has no hardware encoder — stays CPU always.
    },
};
