import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DictationUnavailableError,
  socketUrlFor,
  TranscriptionClient,
} from "./transcriptionClient";

class FakeSocket {
  static instances: FakeSocket[] = [];

  readyState = 0;
  sent: (string | Uint8Array)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor() {
    FakeSocket.instances.push(this);
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
    this.receive({ type: "ready" });
  }

  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  get controls(): Record<string, unknown>[] {
    return this.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry) as Record<string, unknown>);
  }

  get frames(): Uint8Array[] {
    return this.sent.filter((entry): entry is Uint8Array => typeof entry !== "string");
  }
}

const flush = async () => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

let transcripts: [number, string][];
let failures: number[];
let fetchMock: ReturnType<typeof vi.fn>;

function create() {
  return new TranscriptionClient(
    {
      mimeType: "audio/mp4",
      language: "he",
      socketUrl: "wss://store/ws/transcribe",
      uploadUrl: "/api/v1/transcribe",
      statusUrl: "/api/v1/transcribe/status",
      createSocket: () => new FakeSocket() as unknown as WebSocket,
      fetchImpl: fetchMock as unknown as typeof fetch,
    },
    {
      transcript: (segment, text) => transcripts.push([segment, text]),
      failed: (segment) => failures.push(segment),
    },
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function connected() {
  const client = create();
  const ready = client.connect();
  FakeSocket.instances.at(-1)?.open();
  await ready;
  return { client, socket: FakeSocket.instances.at(-1)! };
}

async function uploading() {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/status") ? json({ available: true }) : json({ text: "חלב" }),
  );
  const client = create();
  const ready = client.connect();
  FakeSocket.instances.at(-1)?.drop();
  await ready;
  return client;
}

beforeEach(() => {
  FakeSocket.instances = [];
  transcripts = [];
  failures = [];
  fetchMock = vi.fn();
});

describe("socketUrlFor", () => {
  it("uses wss on https, or the browser refuses it", () => {
    expect(socketUrlFor({ protocol: "https:", host: "10.0.0.5:4173" })).toBe(
      "wss://10.0.0.5:4173/ws/transcribe",
    );
    expect(socketUrlFor({ protocol: "http:", host: "localhost:4173" })).toBe(
      "ws://localhost:4173/ws/transcribe",
    );
  });
});

describe("over the WebSocket", () => {
  it("announces the audio format and language", async () => {
    const { socket } = await connected();

    expect(socket.controls[0]).toEqual({ type: "start", mime_type: "audio/mp4", language: "he" });
  });

  it("sends chunks while recording, tagged with their segment", async () => {
    const { client, socket } = await connected();

    client.chunk(3, new Blob(["ab"]));
    await flush();

    const frame = socket.frames[0]!;
    expect(new DataView(frame.buffer).getUint32(0)).toBe(3);
    expect(new TextDecoder().decode(frame.slice(4))).toBe("ab");
  });

  it("keeps frames in order though blobs read asynchronously", async () => {
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["1"]));
    client.chunk(0, new Blob(["2"]));
    client.endSegment(0);
    await flush();

    expect(socket.sent.map((entry) => (typeof entry === "string" ? "end" : "frame"))).toEqual([
      "end",
      "frame",
      "frame",
      "end",
    ]);
  });

  it("passes transcripts on", async () => {
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["a"]));
    socket.receive({ type: "transcript", segment: 0, text: "חלב" });

    expect(transcripts).toEqual([[0, "חלב"]]);
    expect(client).toBeDefined();
  });

  it("reports a segment the server couldn't read", async () => {
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["a"]));
    socket.receive({ type: "segment_failed", segment: 0 });

    expect(failures).toEqual([0]);
  });

  it("tells the server to drop silence", async () => {
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["a"]));
    client.discardSegment(0);
    await flush();

    expect(socket.controls.at(-1)).toEqual({ type: "segment_discard", segment: 0 });
  });

  it("finishes when the server is done", async () => {
    const { client, socket } = await connected();

    const finished = client.finish();
    await flush();
    expect(socket.controls.at(-1)).toEqual({ type: "finish" });
    socket.receive({ type: "done" });

    await expect(finished).resolves.toBeUndefined();
  });
});

describe("when the WebSocket can't connect, as on iOS with a self-signed certificate", () => {
  it("falls back to uploading whole segments", async () => {
    const client = await uploading();

    client.chunk(0, new Blob(["ab"]));
    client.chunk(0, new Blob(["cd"]));
    client.endSegment(0);
    await flush();

    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/v1/transcribe?language=he");
    expect(new Headers(init.headers).get("Content-Type")).toBe("audio/mp4");
    expect((init.body as Blob).size).toBe(4);
    expect(transcripts).toEqual([[0, "חלב"]]);
  });

  it("reports an upload that failed", async () => {
    const client = await uploading();
    fetchMock.mockImplementation(async () => new Response("", { status: 502 }));

    client.chunk(0, new Blob(["a"]));
    client.endSegment(0);
    await flush();

    expect(failures).toEqual([0]);
  });

  it("finishes once uploads are done", async () => {
    const client = await uploading();

    client.chunk(0, new Blob(["a"]));
    client.endSegment(0);

    await expect(client.finish()).resolves.toBeUndefined();
    expect(transcripts).toEqual([[0, "חלב"]]);
  });

  it("gives up on a socket that never answers", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json({ available: true }));
    const client = create();

    const ready = client.connect();
    await vi.advanceTimersByTimeAsync(2500);
    await ready;

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/transcribe/status");
    vi.useRealTimers();
  });
});

describe("when dictation can't work", () => {
  it("reports it when the server has no engine", async () => {
    const client = create();

    const ready = client.connect();
    FakeSocket.instances.at(-1)?.drop(1013);

    await expect(ready).rejects.toBeInstanceOf(DictationUnavailableError);
  });

  it("reports it when the status says so", async () => {
    fetchMock.mockImplementation(async () => json({ available: false }));
    const client = create();

    const ready = client.connect();
    FakeSocket.instances.at(-1)?.drop();

    await expect(ready).rejects.toBeInstanceOf(DictationUnavailableError);
  });

  it("reports it with no server at all", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const client = create();

    const ready = client.connect();
    FakeSocket.instances.at(-1)?.drop();

    await expect(ready).rejects.toBeInstanceOf(DictationUnavailableError);
  });
});

describe("when the socket drops mid-dictation", () => {
  it("re-uploads what wasn't answered", async () => {
    fetchMock.mockImplementation(async () => json({ text: "לחם" }));
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["a"]));
    client.endSegment(0);
    await flush();
    socket.drop();
    await flush();

    expect(transcripts).toEqual([[0, "לחם"]]);
  });

  it("uploads the segment that was in progress when it ends", async () => {
    fetchMock.mockImplementation(async () => json({ text: "קפה" }));
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["a"]));
    socket.drop();
    client.chunk(0, new Blob(["b"]));
    client.endSegment(0);
    await flush();

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect((init.body as Blob).size).toBe(2);
    expect(transcripts).toEqual([[0, "קפה"]]);
  });

  it("doesn't upload what the server already answered", async () => {
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["a"]));
    client.endSegment(0);
    await flush();
    socket.receive({ type: "transcript", segment: 0, text: "חלב" });
    socket.drop();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finishes after the re-upload", async () => {
    fetchMock.mockImplementation(async () => json({ text: "לחם" }));
    const { client, socket } = await connected();

    client.chunk(0, new Blob(["a"]));
    client.endSegment(0);
    const finished = client.finish();
    await flush();
    socket.drop();

    await expect(finished).resolves.toBeUndefined();
    expect(transcripts).toEqual([[0, "לחם"]]);
  });
});
