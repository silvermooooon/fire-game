import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function addressPriority(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  const secondOctet = Number(address.split(".")[1]);
  if (
    address.startsWith("172.") &&
    secondOctet >= 16 &&
    secondOctet <= 31
  ) {
    return 2;
  }
  return 3;
}

export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const port = requestUrl.port || "3000";
  const addresses = Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter(
      (item) =>
        item.family === "IPv4" &&
        !item.internal &&
        !item.address.startsWith("169.254."),
    )
    .map((item) => item.address)
    .filter((address, index, all) => all.indexOf(address) === index)
    .sort((a, b) => addressPriority(a) - addressPriority(b));

  return NextResponse.json({
    origins: addresses.map((address) => `http://${address}:${port}`),
  });
}
