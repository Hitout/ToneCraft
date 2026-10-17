"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPitch = detectPitch;
const YIN_THRESHOLD = 0.12;
const MINIMUM_FREQUENCY_HZ = 32;
const MAXIMUM_FREQUENCY_HZ = 1200;
const MINIMUM_RMS = 0.0025;
/**
 * 在固定 PCM 窗口上执行 YIN 自相关检测。
 *
 * 下限覆盖降 D 贝斯的约 37Hz；先去除直流偏置，再用能量门限和置信度过滤
 * 静音、低能量噪声与低置信度倍频结果，避免表盘在环境噪音下频繁跳动。
 */
function detectPitch(samples, sampleRate, threshold = YIN_THRESHOLD) {
    if (samples.length < 1024 || sampleRate <= 0)
        return null;
    let mean = 0;
    for (let index = 0; index < samples.length; index++)
        mean += samples[index];
    mean /= samples.length;
    const centered = new Float32Array(samples.length);
    let energy = 0;
    for (let index = 0; index < samples.length; index++) {
        const value = samples[index] - mean;
        centered[index] = value;
        energy += value * value;
    }
    const rms = Math.sqrt(energy / samples.length);
    if (rms < MINIMUM_RMS)
        return null;
    const minimumTau = Math.max(2, Math.floor(sampleRate / MAXIMUM_FREQUENCY_HZ));
    const maximumTau = Math.min(Math.floor(sampleRate / MINIMUM_FREQUENCY_HZ), Math.floor(samples.length / 2));
    if (maximumTau <= minimumTau)
        return null;
    const yin = calculateYin(centered, maximumTau);
    let tauEstimate = -1;
    for (let tau = minimumTau; tau < maximumTau; tau++) {
        if (yin[tau] < threshold) {
            tauEstimate = tau;
            while (tauEstimate + 1 < maximumTau && yin[tauEstimate + 1] < yin[tauEstimate]) {
                tauEstimate++;
            }
            break;
        }
    }
    if (tauEstimate < 0)
        return null;
    const left = yin[Math.max(1, tauEstimate - 1)];
    const center = yin[tauEstimate];
    const right = yin[Math.min(maximumTau, tauEstimate + 1)];
    const denominator = 2 * (2 * center - left - right);
    const adjustment = Math.abs(denominator) > 1e-8 ? (right - left) / denominator : 0;
    const refinedTau = tauEstimate + Math.max(-1, Math.min(1, adjustment));
    const frequencyHz = sampleRate / refinedTau;
    if (!Number.isFinite(frequencyHz) || frequencyHz < MINIMUM_FREQUENCY_HZ || frequencyHz > MAXIMUM_FREQUENCY_HZ) {
        return null;
    }
    const confidence = Math.max(0, Math.min(1, 1 - center));
    if (confidence < 0.55)
        return null;
    return {
        frequencyHz,
        confidence,
        rms,
    };
}
/** 用 FFT 自相关计算相同的 YIN 差分，避免对每个周期重复遍历整个窗口。 */
function calculateYin(samples, maximumTau) {
    let size = 1;
    while (size < samples.length * 2)
        size *= 2;
    const real = new Float64Array(size);
    const imaginary = new Float64Array(size);
    const energy = new Float64Array(samples.length + 1);
    for (let index = 0; index < samples.length; index++) {
        real[index] = samples[index];
        energy[index + 1] = energy[index] + samples[index] * samples[index];
    }
    transform(real, imaginary, false);
    for (let index = 0; index < size; index++) {
        real[index] = real[index] * real[index] + imaginary[index] * imaginary[index];
        imaginary[index] = 0;
    }
    transform(real, imaginary, true);
    const yin = new Float32Array(maximumTau + 1);
    let runningSum = 0;
    for (let tau = 1; tau <= maximumTau; tau++) {
        // 两段各自的能量必须按重叠长度截取，才能与逐点差分完全对应。
        const difference = Math.max(0, energy[samples.length - tau] + energy[samples.length] - energy[tau] - 2 * real[tau]);
        runningSum += difference;
        yin[tau] = runningSum === 0 ? 1 : difference * tau / runningSum;
    }
    return yin;
}
function transform(real, imaginary, inverse) {
    const size = real.length;
    let reversed = 0;
    for (let index = 1; index < size; index++) {
        let bit = size >> 1;
        while ((reversed & bit) !== 0) {
            reversed ^= bit;
            bit >>= 1;
        }
        reversed ^= bit;
        if (index < reversed) {
            const realValue = real[index];
            const imaginaryValue = imaginary[index];
            real[index] = real[reversed];
            imaginary[index] = imaginary[reversed];
            real[reversed] = realValue;
            imaginary[reversed] = imaginaryValue;
        }
    }
    for (let length = 2; length <= size; length *= 2) {
        const half = length / 2;
        const angle = (inverse ? 2 : -2) * Math.PI / length;
        const rootReal = Math.cos(angle);
        const rootImaginary = Math.sin(angle);
        for (let start = 0; start < size; start += length) {
            let twiddleReal = 1;
            let twiddleImaginary = 0;
            for (let offset = 0; offset < half; offset++) {
                const even = start + offset;
                const odd = even + half;
                const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
                const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
                real[odd] = real[even] - oddReal;
                imaginary[odd] = imaginary[even] - oddImaginary;
                real[even] += oddReal;
                imaginary[even] += oddImaginary;
                const nextReal = twiddleReal * rootReal - twiddleImaginary * rootImaginary;
                twiddleImaginary = twiddleReal * rootImaginary + twiddleImaginary * rootReal;
                twiddleReal = nextReal;
            }
        }
    }
    if (inverse) {
        for (let index = 0; index < size; index++)
            real[index] /= size;
    }
}
