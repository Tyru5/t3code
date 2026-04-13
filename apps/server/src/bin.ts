// @ts-nocheck
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import { NetService } from "@t3tools/shared/Net";
import { cli } from "./cli";
import { version } from "../package.json" with { type: "json" };

const CliRuntimeLayer = () =>
  typeof Bun === "undefined"
    ? Layer.mergeAll(NodeServices.layer, NetService.layer)
    : Layer.mergeAll(BunServices.layer, NetService.layer);

const runMain = typeof Bun === "undefined" ? NodeRuntime.runMain : BunRuntime.runMain;

Command.run(cli, { version }).pipe(Effect.scoped, Effect.provide(CliRuntimeLayer()), runMain);
