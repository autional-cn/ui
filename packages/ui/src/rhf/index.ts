// react-hook-form 绑定入口 —— 与默认入口分离。
//
// 为什么单独一个子路径（与 ./antd 同一个理由）：根入口的消费方里有不吃 react-hook-form 的
// （5 个 Astro 站、营销站），把绑定控件并进根入口等于让所有人替一个他们不用的库付包体积。
// 所以 react-hook-form 是 **optional peerDependency**，且默认入口 0 处 import 它（第 19 道闸门断言）。

export { FormInput } from './FormInput';
export type { FormInputProps } from './FormInput';
export { FormSelect } from './FormSelect';
export type { FormSelectProps } from './FormSelect';
export { FormTextarea } from './FormTextarea';
export type { FormTextareaProps } from './FormTextarea';
export type { FormControlBaseProps } from './shared';
// 自研控件要接同一套 a11y 接线时用这两个：
export { useBoundField } from './shared';
export { FormField, useFormFieldA11y } from '../molecules/FormField';
export type { FormFieldProps } from '../molecules/FormField';
