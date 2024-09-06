import BaseAction from '../BaseAction'
import { ActionName } from '../types'

interface Payload {
  message_id: number
}

export class MarkMsgAsRead extends BaseAction<Payload, null> {
  actionName = ActionName.GoCQHTTP_MarkMsgAsRead

  protected async _handle() {
    return null
  }
}
