import { MiniProfile, ProfileBizType, SimpleInfo, User, UserDetailInfoV2, UserDetailSource, UserDetailInfo } from '../types'
import { invoke, NTClass } from '../ntcall'
import { getBuildVersion } from '@/common/utils'
import { RequestUtil } from '@/common/utils/request'
import { isNullable, pick, Time } from 'cosmokit'
import { Service, Context } from 'cordis'
import { selfInfo } from '@/common/globalVars'

declare module 'cordis' {
  interface Context {
    ntUserApi: NTQQUserApi
  }
}

export class NTQQUserApi extends Service {
  static inject = ['ntFriendApi', 'ntGroupApi']

  constructor(protected ctx: Context) {
    super(ctx, 'ntUserApi', true)
  }

  async setSelfAvatar(path: string) {
    return await invoke(
      'nodeIKernelProfileService/setHeader',
      [{ path }],
      {
        timeout: 10 * Time.second // 10秒不一定够
      }
    )
  }

  async fetchUserDetailInfo(uid: string) {
    const result = await invoke<{ info: UserDetailInfoV2 }>(
      'nodeIKernelProfileService/fetchUserDetailInfo',
      [{
        callFrom: 'BuddyProfileStore',
        uid: [uid],
        source: UserDetailSource.KSERVER,
        bizList: [ProfileBizType.KALL]
      }],
      {
        cbCmd: 'nodeIKernelProfileListener/onUserDetailInfoChanged',
        afterFirstCmd: false,
        cmdCB: payload => payload.info.uid === uid,
      }
    )
    return result.info
  }

  async getUserDetailInfo(uid: string) {
    if (getBuildVersion() >= 26702) {
      const info = await this.fetchUserDetailInfo(uid)
      return {
        ...info.simpleInfo.coreInfo,
        ...info.simpleInfo.status,
        ...info.simpleInfo.vasInfo,
        ...info.commonExt,
        ...info.simpleInfo.baseInfo,
        ...info.simpleInfo.relationFlags,
        photoWall: info.photoWall,
        pendantId: ''
      } as UserDetailInfo
    }
    const result = await invoke<{ info: UserDetailInfo }>(
      'nodeIKernelProfileService/getUserDetailInfoWithBizInfo',
      [{
        uid,
        bizList: [0]
      }],
      {
        cbCmd: 'nodeIKernelProfileListener/onProfileDetailInfoChanged',
        afterFirstCmd: false,
        cmdCB: (payload) => payload.info.uid === uid,
      }
    )
    return result.info
  }

  async getCookies(domain: string) {
    const clientKeyData = await this.forceFetchClientKey()
    if (clientKeyData?.result !== 0) {
      throw new Error('获取clientKey失败')
    }
    const uin = selfInfo.uin
    const requestUrl = 'https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=' + uin + '&clientkey=' + clientKeyData.clientKey + '&u1=https%3A%2F%2F' + domain + '%2F' + uin + '%2Finfocenter&keyindex=19%27'
    const cookies: { [key: string]: string } = await RequestUtil.HttpsGetCookies(requestUrl)
    return cookies
  }

  async getPSkey(domains: string[]) {
    return await invoke('nodeIKernelTipOffService/getPskey', [{ domains, isForNewPCQQ: true }])
  }

  async like(uid: string, count = 1) {
    return await invoke(
      'nodeIKernelProfileLikeService/setBuddyProfileLike',
      [{
        doLikeUserInfo: {
          friendUid: uid,
          sourceId: 71,
          doLikeCount: count,
          doLikeTollCount: 0
        }
      }]
    )
  }

  async getUidByUinV1(uin: string, groupCode?: string) {
    let uid = (await invoke('nodeIKernelUixConvertService/getUid', [{ uins: [uin] }])).uidInfo.get(uin)
    if (!uid && groupCode) {
      let member = await this.ctx.ntGroupApi.searchMember(groupCode, uin)
      if (member.size === 0) {
        await this.ctx.ntGroupApi.getGroupMembers(groupCode, 1)
        await this.ctx.sleep(40)
        member = await this.ctx.ntGroupApi.searchMember(groupCode, uin)
      }
      uid = Array.from(member.values()).find(e => e.uin === uin)?.uid
    }
    if (!uid) {
      const snapShot = await this.getRecentContactListSnapShot(10)
      uid = snapShot.info.changedList.find(e => e.senderUin === uin)?.senderUid
    }
    if (!uid) {
      const friends = await this.ctx.ntFriendApi.getFriends()
      uid = friends.find(item => item.uin === uin)?.uid
    }
    if (!uid) {
      const unveifyUid = (await this.getUserDetailInfoByUin(uin)).info!.uid
      if (!unveifyUid.includes('*')) {
        uid = unveifyUid
      }
    }
    return uid
  }

  async getUidByUinV2(uin: string) {
    let uid = (await invoke('nodeIKernelGroupService/getUidByUins', [{ uinList: [uin] }])).uids.get(uin)
    if (uid) return uid
    uid = (await invoke('nodeIKernelProfileService/getUidByUin', [{ callFrom: 'FriendsServiceImpl', uin: [uin] }])).get(uin)
    if (uid) return uid
    uid = (await invoke('nodeIKernelUixConvertService/getUid', [{ uins: [uin] }])).uidInfo.get(uin)
    if (uid) return uid
    const unveifyUid = (await this.getUserDetailInfoByUin(uin)).detail!.uid
    //if (!unveifyUid.includes('*')) return unveifyUid
    return unveifyUid
  }

  async getUidByUin(uin: string, groupCode?: string) {
    if (getBuildVersion() >= 26702) {
      return this.getUidByUinV2(uin)
    }
    return this.getUidByUinV1(uin, groupCode)
  }

  async getUserDetailInfoByUin(uin: string) {
    return await invoke('nodeIKernelProfileService/getUserDetailInfoByUin', [{ uin }])
  }

  async getUinByUidV1(uid: string) {
    const ret = await invoke('nodeIKernelUixConvertService/getUin', [{ uids: [uid] }])
    let uin = ret.uinInfo.get(uid)
    if (!uin) {
      uin = (await this.getUserDetailInfo(uid)).uin
    }
    return uin
  }

  async getUinByUidV2(uid: string) {
    let uin = (await invoke('nodeIKernelGroupService/getUinByUids', [{ uidList: [uid] }])).uins.get(uid)
    if (uin && uin !== '0') return uin
    uin = (await invoke('nodeIKernelProfileService/getUinByUid', [{ callFrom: 'FriendsServiceImpl', uid: [uid] }])).get(uid)
    if (uin) return uin
    uin = (await invoke('nodeIKernelUixConvertService/getUin', [{ uids: [uid] }])).uinInfo.get(uid)
    if (uin) return uin
    uin = (await this.ctx.ntFriendApi.getBuddyIdMap()).get(uid)
    if (uin) return uin
    uin = (await this.getUserDetailInfo(uid)).uin
    return uin
  }

  async getUinByUid(uid: string) {
    if (getBuildVersion() >= 26702) {
      return this.getUinByUidV2(uid)
    }
    return this.getUinByUidV1(uid)
  }

  async forceFetchClientKey() {
    return await invoke('nodeIKernelTicketService/forceFetchClientKey', [{ url: '' }])
  }

  async getSelfNick(refresh = true) {
    if ((refresh || !selfInfo.nick) && selfInfo.uid) {
      const data = await this.getUserSimpleInfo(selfInfo.uid)
      selfInfo.nick = data.nick
    }
    return selfInfo.nick
  }

  async setSelfStatus(status: number, extStatus: number, batteryStatus: number) {
    return await invoke('nodeIKernelMsgService/setStatus', [{
      statusReq: {
        status,
        extStatus,
        batteryStatus,
      }
    }])
  }

  async getProfileLike(uid: string, start = 0, limit = 20) {
    return await invoke('nodeIKernelProfileLikeService/getBuddyProfileLike', [{
      req: {
        friendUids: [uid],
        basic: 1,
        vote: 0,
        favorite: 1,
        userProfile: 1,
        type: 3,
        start,
        limit,
      }
    }])
  }

  async getProfileLikeMe(uid: string, start = 0, limit = 20) {
    return await invoke('nodeIKernelProfileLikeService/getBuddyProfileLike', [{
      req: {
        friendUids: [uid],
        basic: 1,
        vote: 1,
        favorite: 0,
        userProfile: 1,
        type: 2,
        start,
        limit,
      }
    }])
  }

  async getUserSimpleInfoV2(uid: string, force = true) {
    const data = await invoke<{ profiles: Record<string, SimpleInfo> }>(
      'nodeIKernelProfileService/getUserSimpleInfo',
      [{
        uids: [uid],
        force
      }],
      {
        cbCmd: 'onProfileSimpleChanged',
        afterFirstCmd: false,
        cmdCB: payload => !isNullable(payload.profiles[uid]),
      }
    )
    return data.profiles[uid].coreInfo
  }

  async getUserSimpleInfo(uid: string, force = true) {
    if (getBuildVersion() >= 26702) {
      return this.getUserSimpleInfoV2(uid, force)
    }
    const data = await invoke<{ profiles: Map<string, User> }>(
      'nodeIKernelProfileService/getUserSimpleInfo',
      [{
        uids: [uid],
        force
      }],
      {
        cbCmd: 'nodeIKernelProfileListener/onProfileSimpleChanged',
        afterFirstCmd: false,
        cmdCB: payload => payload.profiles.has(uid),
      }
    )
    const profile = data.profiles.get(uid)!
    return pick(profile, ['nick', 'remark', 'uid', 'uin'])
  }

  async getCoreAndBaseInfo(uids: string[]) {
    return await invoke(
      'nodeIKernelProfileService/getCoreAndBaseInfo',
      [{
        uids,
        callFrom: 'nodeStore'
      }]
    )
  }

  async getRobotUinRange() {
    const data = await invoke(
      'nodeIKernelRobotService/getRobotUinRange',
      [{
        req: {
          justFetchMsgConfig: '1',
          type: 1,
          version: 0,
          aioKeywordVersion: 0
        }
      }]
    )
    return data.response.robotUinRanges
  }

  async quitAccount() {
    return await invoke(
      'quitAccount',
      [],
      {
        className: NTClass.BUSINESS_API,
      }
    )
  }

  async modifySelfProfile(profile: MiniProfile) {
    return await invoke('nodeIKernelProfileService/modifyDesktopMiniProfile', [{ profile }])
  }

  async getRecentContactListSnapShot(count: number) {
    return await invoke('nodeIKernelRecentContactService/getRecentContactListSnapShot', [{ count }])
  }
}
