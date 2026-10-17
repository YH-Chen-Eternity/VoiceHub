/*
Copyright (C) 2026 YH-Chen

This file is part of VoiceHub-Plus (an unofficial community edition),
based on VoiceHub <https://github.com/laoshuikaixue/VoiceHub>.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { computed } from 'vue'
import { useLocale } from '~/utils/locale'
import { newUiZh, newUiEn, type NewUiDict } from '~/utils/locale/newUi'

/**
 * 新增界面的双语词条（跟随站点当前语言）。
 * 用法：const t = useNewUi(); ... t.value.announcement.title
 */
export function useNewUi() {
  const { currentLocale } = useLocale()
  return computed<NewUiDict>(() => (currentLocale.value === 'en-US' ? newUiEn : newUiZh))
}
