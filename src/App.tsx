import "./App.css";
import { useState } from "react";
import { connect as serial_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import { create_rpc_connection } from "@zmkfirmware/zmk-studio-ts-client";

function App() {
  return (
    <>
      <h1>ZMK Exporter</h1>
    <p>Connect a ZMK Studio-enabled keyboard and extract the physical layout and layer bindings.</p>

        <div>
              <PortView />
        </div>
        <footer>theor | <a href="https://theor.xyz/">blog</a> |  <a href="https://github.com/theor/zmk-exporter"><svg width="16" height="16" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" transform="scale(64)" fill="#1B1F23"/>
</svg></a></footer>
    </>
  );
}

async function connect(): Promise<KeyboardData> {
  const ac = new AbortController();
  const transport = await serial_connect();
  let conn = await create_rpc_connection(transport, { signal: ac.signal });

  let details = await Promise.race([
    call_rpc(conn, { core: { getDeviceInfo: true } })
      .then((r) => r?.core?.getDeviceInfo)
      .catch((e) => {
        console.error("Failed first RPC call", e);
        return undefined;
      }),
    valueAfter(undefined, 1000),
  ]);
  console.log("details", details);
  return await getData(conn);
}

interface KeyboardData {
  physical: PhysicalLayouts;
  keymaps: BehaviorBinding[][];
}
async function getData(conn: RpcConnection) {
  let physical = (
    await call_rpc(conn, { keymap: { getPhysicalLayouts: true } })
  ).keymap?.getPhysicalLayouts ?? {activeLayoutIndex:-1,layouts:[]};

  let resp = await call_rpc(conn, { keymap: { getKeymap: true } });
  const layers = resp.keymap?.getKeymap?.layers as Layer[];

  var allBindings = layers.flatMap((l, li) =>
    l.bindings.map((b, bi) => {
      let label = undefined;
      const mods = (b.param1 >> 24) & 0xff;
      if (b.behaviorId === 4) {
        // remove mods
        const usage = b.param1 & ~(0xff << 24);
        const [page, id] = hid_usage_page_and_id_from_usage(usage);
        const labels = hid_usage_get_labels(page, id);
        // console.warn(li,bi, b.param1, page, id,labels);
        label = labels.short;
      }
      return { layer: li, binding: bi, bindingData: { ...b, label, mods } };
    })
  );
  // object with one entry per binding, where each item is an object with 1 entry per layer
  // { 0: { 0: {behaviorId: 4, ...}, 1: ...} }
  var merged = allBindings.reduce((acc: BehaviorBinding[][], b) => {
    acc[b.binding] = acc[b.binding] || [];
    acc[b.binding][b.layer] = b.bindingData;
    return acc;
  }, []);
  // console.warn(merged);
  // console.warn(JSON.stringify(merged, null, 2));

  return { physical, keymaps: merged };
}

const PortView = () => {
  const [conn, setConn] = useState<KeyboardData | undefined>(undefined);
  const copy = () => navigator
    .clipboard.writeText(JSON.stringify(conn, undefined, 2))
    .catch((e) => console.error("Failed to copy", e));
  const download = () => {
    const blob = new Blob([JSON.stringify(conn, undefined, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keyboard.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      {!conn && (
        <button
          onClick={() => {
            connect().then(setConn);
          }}
        >
          Connect
        </button>
      )}
            {conn && <div className="toolbar">
        <button onClick={copy}>Copy</button>
        <button onClick={download}>Download</button>
        </div>}
      <pre>
      {JSON.stringify(conn,undefined,2)}
      </pre>

    </div>
  );
};

export default App;

export function valueAfter<T>(val: T, ms?: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(val), ms);
  });
}

import {
  call_rpc as inner_call_rpc,
  Request,
  RequestResponse,
  RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client";
import { BehaviorBinding, Layer, PhysicalLayouts } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { hid_usage_get_labels, hid_usage_page_and_id_from_usage } from "./hid_usage";

export async function call_rpc(
  conn: RpcConnection,
  req: Omit<Request, "requestId">
): Promise<RequestResponse> {
  console.log("RPC Request", req);
  return inner_call_rpc(conn, req)
    .then((r) => {
      console.log("RPC Response", r);
      return r;
    })
    .catch((e) => {
      console.error("RPC Error", e);
      return e;
    });
}
