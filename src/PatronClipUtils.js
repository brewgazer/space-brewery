/**
 * Map glTF animation clips to gameplay roles. Never uses T-pose / bind poses as idle.
 */

function normName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[\s_\-]/g, '');
}

function isExcludedPose(name) {
    const n = normName(name);
    return (
        n.includes('tpose') ||
        n.includes('bind') ||
        n.includes('reference') ||
        n.includes('apose') ||
        n === 'a' ||
        n.includes('restpose') ||
        /^take\d*$/.test(n) ||
        n.startsWith('take') ||
        n.includes('mixamo.com')
    );
}

function firstClip(animations, test) {
    for (const a of animations) {
        if (!a || isExcludedPose(a.name)) continue;
        const n = normName(a.name);
        if (test(n, a.name)) return a;
    }
    return null;
}

/**
 * @param {import('three').AnimationClip[]} animations
 * @returns {{ idle: AnimationClip|null, walk: AnimationClip|null, drink: AnimationClip|null, happy: AnimationClip|null, angry: AnimationClip|null }}
 */
export function pickPatronClips(animations) {
    if (!animations?.length) {
        return { idle: null, walk: null, drink: null, happy: null, angry: null };
    }

    let idle =
        firstClip(animations, (n) => n.includes('idle') && !n.includes('idleturn')) ||
        firstClip(animations, (n) => n === 'standing' || (n.includes('stand') && !n.includes('walk'))) ||
        firstClip(animations, (n) => n.includes('idle'));

    let walk =
        firstClip(animations, (n) => n.includes('walk') && !n.includes('backward')) ||
        firstClip(animations, (n) => n.includes('walking')) ||
        firstClip(animations, (n) => n.includes('run') || n.includes('jog'));

    const drink =
        firstClip(animations, (n) => n.includes('sit')) ||
        firstClip(animations, (n) => n.includes('drink') || n.includes('sip') || n.includes('toast')) ||
        firstClip(animations, (n) => n.includes('eat'));

    const happy =
        firstClip(animations, (n) => n.includes('wave') || n.includes('thumbsup') || n.includes('thumbs')) ||
        firstClip(animations, (n) => n.includes('yes') || n.includes('cheer') || n.includes('dance')) ||
        null;

    const angry =
        firstClip(animations, (n) => n === 'no' || n.includes('shakehead')) ||
        firstClip(animations, (n) => n.includes('angry') || n.includes('frustrat')) ||
        null;

    if (!idle) {
        for (const a of animations) {
            if (a && !isExcludedPose(a.name)) {
                idle = a;
                break;
            }
        }
    }
    if (!idle && animations[0]) idle = animations[0];

    if (!walk) walk = idle;

    return {
        idle,
        walk,
        drink,
        happy: happy || idle,
        angry: angry || idle,
    };
}
