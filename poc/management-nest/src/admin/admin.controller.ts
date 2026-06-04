import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { hashClientSecret } from "@naskot/node-hmac-auth-core";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service.js";
import { HmacPropagatorService } from "../hmac-propagator/hmac-propagator.service.js";
import { HmacCredential, HmacCredentialTarget, HmacPropagationTarget } from "../hmac-propagation-data/entities/index.js";
import {
  AdminApiTag,
  CallTargetApi,
  CreateTargetApi,
  DeleteTargetApi,
  EnsureApi,
  HashApi,
  RevokeApi,
  RotateApi,
  StateApi,
  SyncApi,
} from "./admin.openapi.js";
import { CallTargetDto, CallTargetResponseDto } from "./dto/call-target.dto.js";
import { EnsureDto } from "./dto/ensure.dto.js";
import { HashResponseDto } from "./dto/hash.dto.js";
import { RevokeDto } from "./dto/revoke.dto.js";
import { RotateDto } from "./dto/rotate.dto.js";
import { StateResponseDto } from "./dto/state.dto.js";
import { CreateTargetDto, TargetMutationResponseDto } from "./dto/target.dto.js";

@AdminApiTag
@Controller("admin")
export class AdminController {
  constructor(
    @Inject(HmacAuthService) private readonly hmacAuth: HmacAuthService,
    @Inject(HmacPropagatorService) private readonly propagator: HmacPropagatorService,
    @InjectRepository(HmacCredential) private readonly credentials: Repository<HmacCredential>,
    @InjectRepository(HmacPropagationTarget) private readonly targets: Repository<HmacPropagationTarget>,
    @InjectRepository(HmacCredentialTarget) private readonly ct: Repository<HmacCredentialTarget>
  ) {}

  @Post("ensure")
  @EnsureApi()
  async ensure(@Body() body: EnsureDto) {
    return this.propagator.ensure({ clientId: body.clientId, secret: body.secret, targets: body.targets });
  }

  @Post("rotate")
  @RotateApi()
  async rotate(@Body() body: RotateDto) {
    return this.propagator.rotate({ clientId: body.clientId, secret: body.secret });
  }

  @Post("revoke")
  @RevokeApi()
  async revoke(@Body() body: RevokeDto) {
    return this.propagator.revoke({ clientId: body.clientId, targets: body.targets });
  }

  @Post("sync")
  @SyncApi()
  async sync() {
    return this.propagator.sync();
  }

  @Get("state")
  @StateApi()
  async state(): Promise<StateResponseDto> {
    const [credentials, targets, pivots] = await Promise.all([this.credentials.find(), this.targets.find(), this.ct.find()]);
    return { credentials, targets, pivots };
  }

  @Post("call-target")
  @CallTargetApi()
  async callTarget(@Body() body: CallTargetDto): Promise<CallTargetResponseDto> {
    const fetchSigned = this.hmacAuth.http.createHttpSignedFetchClient({
      clientId: body.clientId,
      secret: body.secret,
      hashToken: process.env.HMAC_SECRET_TOKEN,
    });
    const res = await fetchSigned(body.target, { method: "GET" });
    const text = await res.text();
    return { status: res.status, body: text };
  }

  @Get("hash/:plain")
  @HashApi()
  hash(@Param("plain") plain: string): HashResponseDto {
    return { hash: hashClientSecret(plain, process.env.HMAC_SECRET_TOKEN) };
  }

  @Post("targets")
  @CreateTargetApi()
  async createTarget(@Body() body: CreateTargetDto): Promise<TargetMutationResponseDto> {
    const existing = await this.targets.findOne({ where: { targetAmqpQueue: body.targetAmqpQueue } });
    await this.targets.save({
      targetAmqpQueue: body.targetAmqpQueue,
      propagationSecret: body.propagationSecret,
      note: body.note ?? null,
    });
    return { op: existing ? "target.update" : "target.create", targetAmqpQueue: body.targetAmqpQueue };
  }

  @Delete("targets/:queue")
  @DeleteTargetApi()
  async deleteTarget(@Param("queue") queue: string): Promise<TargetMutationResponseDto> {
    if (queue === process.env.AMQP_QUEUE) {
      throw new BadRequestException("Cannot delete the peer's own self-target row (it is used for inbound ACK signing).");
    }
    await this.targets.manager.transaction(async (tx) => {
      await tx.delete(HmacCredentialTarget, { targetAmqpQueue: queue });
      await tx.delete(HmacPropagationTarget, { targetAmqpQueue: queue });
    });
    return { op: "target.delete", targetAmqpQueue: queue };
  }
}
