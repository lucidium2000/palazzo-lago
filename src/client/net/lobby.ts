import { AVATARS, AvatarPreview } from './avatars';
import { connect, newCode, normalizeCode, type Transport } from './transport';

export interface LobbyChoice {
  name: string;
  avatar: number;
  /** Set for a two-player game. */
  net: { transport: Transport; host: boolean } | null;
  /** Go straight into the headset. */
  vr?: boolean;
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/**
 * The start screen: pick a character (cycle or random), type a name, then
 * play solo, host a two-player room (shows a code to send a friend), or
 * join a friend's room by code. Calls `onStart` when the player steps in.
 */
export function setupLobby(onStart: (c: LobbyChoice) => void, opts: { vr?: boolean } = {}) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const nameInput = $<HTMLInputElement>('player-name');
  const label = $('av-label');
  const status = $('net-status');
  const soloBtn = $<HTMLButtonElement>('enter-btn');
  const hostBtn = $<HTMLButtonElement>('host-btn');
  const joinBtn = $<HTMLButtonElement>('join-btn');
  const joinRow = $<HTMLFormElement>('join-row');
  const joinCode = $<HTMLInputElement>('join-code');
  const preview = new AvatarPreview($<HTMLCanvasElement>('av-canvas'));

  let avatar = Number(store.get('lago.avatar') ?? NaN);
  if (!(avatar >= 0 && avatar < AVATARS.length)) avatar = Math.floor(Math.random() * AVATARS.length);
  nameInput.value = store.get('lago.name') ?? '';
  const show = () => {
    label.textContent = AVATARS[avatar].label;
    preview.show(avatar);
    store.set('lago.avatar', String(avatar));
  };
  show();
  $('av-prev').addEventListener('click', () => {
    avatar = (avatar + AVATARS.length - 1) % AVATARS.length;
    show();
  });
  $('av-next').addEventListener('click', () => {
    avatar = (avatar + 1) % AVATARS.length;
    show();
  });
  $('av-random').addEventListener('click', () => {
    let n = avatar;
    while (AVATARS.length > 1 && n === avatar) n = Math.floor(Math.random() * AVATARS.length);
    avatar = n;
    show();
  });

  // ?join=7K2F in the link pre-fills the code.
  const linkCode = normalizeCode(new URLSearchParams(location.search).get('join') ?? '');
  if (linkCode) {
    joinRow.hidden = false;
    joinCode.value = `LAGO-${linkCode}`;
  }

  let net: LobbyChoice['net'] = null;
  let busy = false;
  const name = () => {
    const n = nameInput.value.trim().slice(0, 16) || AVATARS[avatar].label;
    store.set('lago.name', nameInput.value.trim());
    return n;
  };
  const setStatus = (html: string, err = false) => {
    status.innerHTML = html;
    status.classList.toggle('err', err);
  };
  const start = (vr = false) => {
    preview.dispose();
    onStart({ name: name(), avatar, net, vr });
  };
  const vrBtn = $<HTMLButtonElement>('vr-start');
  if (opts.vr) {
    vrBtn.hidden = false;
    vrBtn.addEventListener('click', () => {
      if (!busy) start(true);
    });
  }

  soloBtn.addEventListener('click', () => {
    if (busy) return;
    start();
  });

  hostBtn.addEventListener('click', async () => {
    if (busy || net) return;
    busy = true;
    hostBtn.disabled = joinBtn.disabled = true;
    setStatus('Opening a room…');
    const code = newCode();
    try {
      const transport = await connect(code, true);
      net = { transport, host: true };
      setStatus(`Your room code<span class="code">LAGO-${code}</span>Send it to your friend. They'll walk in when they join.`);
      soloBtn.textContent = 'Step inside';
    } catch (e) {
      setStatus(`Couldn't open a room: ${(e as Error).message}`, true);
      hostBtn.disabled = joinBtn.disabled = false;
    }
    busy = false;
  });

  joinBtn.addEventListener('click', () => {
    if (net) return;
    joinRow.hidden = false;
    joinCode.focus();
  });

  joinRow.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || net) return;
    const code = normalizeCode(joinCode.value);
    if (!code) {
      setStatus('Room codes look like LAGO-7K2F', true);
      return;
    }
    busy = true;
    hostBtn.disabled = joinBtn.disabled = true;
    setStatus(`Joining LAGO-${code}…`);
    try {
      const transport = await connect(code, false);
      net = { transport, host: false };
      busy = false;
      start();
    } catch (err) {
      setStatus(`Couldn't join: ${(err as Error).message}`, true);
      hostBtn.disabled = joinBtn.disabled = false;
      busy = false;
    }
  });
}
