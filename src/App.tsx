import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import { connect as serial_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { create_rpc_connection } from "@zmkfirmware/zmk-studio-ts-client";

async function needsSerialAuthorization() {
  const ports = await navigator.serial.getPorts();
  if (ports.length > 0) {
    console.log("Port selected:", ports);
    return false;
    // You can now use the selected port for communication
  } else {
    console.log("No port selected");
    return true;
  }
}

function useAsync<T>(asyncFunction: () => Promise<T>) {
  const [get, set] = useState<T>();
  useEffect(() => {
    asyncFunction().then((result) => set(result));
  }, [asyncFunction]);
  return [get, set];
}

async function useDevice(): Promise<SerialPort> {
  // await navigator.serial.requestPort();
  const ports = await navigator.serial.getPorts();
  if (ports.length === 0) return undefined;

  console.log(ports);

  // Initialize the list of available ports with `ports` on page load.
}

function App() {
  const [needsAuth] = useAsync(needsSerialAuthorization);
  const [port, setPort] = useState<SerialPort | undefined>(undefined);
  useEffect(() => {
    if (!needsAuth)
      navigator.serial.getPorts().then((ports) => {
        console.log("Ports:", ports);
        setPort(ports[0]);
      });
  }, [needsAuth]);

  // useDevice();
  return (
    <>
      <h1>ZMK Exporter</h1>
      <div className="card">
        <div>
          {!needsAuth || port ? (
            <>
              <span>
                Serial port selected: {JSON.stringify(port?.getInfo())}
              </span>
              {port && <PortView port={port!} />}
            </>
          ) : (
            <button
              onClick={() => navigator.serial.requestPort().then(setPort)}
            >
              Please select a serial port
            </button>
          )}
        </div>
      </div>
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
  // setJson(JSON.stringify({ physical, keymaps: merged }, null, 2));
}

const PortView = ({ port }: { port: SerialPort }) => {
  const [conn, setConn] = useState<KeyboardData | undefined>(undefined);
  // const [transport, setTransport] = useState<RpcTransport|undefined>(undefined);
  // useEffect(() => {
  //   serial_connect().then(t => console.log("TRANSPORT", t));
  // }, [port]);
  // if(!transport)return;

  // }, [transport]);
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
      <h2>Port Info</h2>
      {port.readable && <p>Port is readable</p>}
      <pre>
      {JSON.stringify(conn,undefined,2)}
      </pre>
      {conn && <div></div>}
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
