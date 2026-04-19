import * as THREE from 'three';

/**
 * Remap animation clip track node names so clips from another FBX file
 * (e.g. Mixamo-style) apply to the Meshy brewer hierarchy.
 */
export function collectObjectNames(root) {
    const names = [];
    root.traverse((o) => {
        if (o.name) names.push(o.name);
    });
    return names;
}

function boneSuffix(name) {
    const parts = String(name).split(':');
    return parts[parts.length - 1] || name;
}

/** Take last `|` segment (Three.js binding paths) and strip common Mixamo-style prefixes. */
function normalizeAnimBoneName(name) {
    let s = String(name).trim();
    if (s.includes('|')) s = s.split('|').pop();
    s = s.replace(/^mixamorig:/i, '').replace(/^mixamorig/i, '');
    return s;
}

/**
 * Map a track's first path segment (object name) to a name that exists on `targetRoot`.
 */
export function mapTrackNodeToTarget(sourceNodeName, targetNames) {
    if (targetNames.includes(sourceNodeName)) return sourceNodeName;

    const norm = normalizeAnimBoneName(sourceNodeName);
    const suf = boneSuffix(sourceNodeName);
    const normSuf = boneSuffix(norm);

    if (norm && targetNames.includes(norm)) return norm;

    const byExact = targetNames.find(
        (n) => n === suf || n === norm || n === normSuf || normalizeAnimBoneName(n) === norm
    );
    if (byExact) return byExact;

    for (const t of targetNames) {
        const bt = boneSuffix(t);
        if (norm && (bt === norm || bt.toLowerCase() === norm.toLowerCase())) return t;
        if (bt === suf || bt === normSuf) return t;
    }

    const colon = targetNames.find(
        (n) =>
            boneSuffix(n) === suf ||
            boneSuffix(n) === norm ||
            n.endsWith(':' + suf) ||
            n.endsWith('|' + suf)
    );
    if (colon) return colon;

    return targetNames.find((n) => n.toLowerCase() === sourceNodeName.toLowerCase()) || null;
}

/**
 * @param {import('three').AnimationClip} clip
 * @param {import('three').Object3D} targetRoot — scaled & grounded character root
 */
export function retargetClipToModel(clip, targetRoot) {
    if (!clip?.tracks?.length || !targetRoot) return clip;
    const targetNames = collectObjectNames(targetRoot);
    const tracks = [];
    for (const t of clip.tracks) {
        const dot = t.name.indexOf('.');
        if (dot < 0) {
            tracks.push(t);
            continue;
        }
        const node = t.name.slice(0, dot);
        const rest = t.name.slice(dot);
        const mapped = mapTrackNodeToTarget(node, targetNames);
        if (!mapped) continue;
        if (mapped === node) {
            tracks.push(t);
        } else {
            const nt = t.clone();
            nt.name = mapped + rest;
            tracks.push(nt);
        }
    }
    if (tracks.length === 0) return null;
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
