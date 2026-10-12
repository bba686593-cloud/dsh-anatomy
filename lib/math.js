// Mathematical notation is data. It is rendered locally and never evaluated.
export const FORMULA_GROUPS = [
  ['基础与代数', [
    ['分式',String.raw`\frac{a}{b}`],['平方与下标',String.raw`x_i^2`],['根式',String.raw`\sqrt{x^2+y^2}`],['任意次根',String.raw`\sqrt[n]{x}`],
    ['函数',String.raw`y=f(x)`],['指数与对数',String.raw`y=e^x,\quad z=\log_a x`],['绝对值',String.raw`\left|x-y\right|\leq\varepsilon`],['分段函数',String.raw`f(x)=\begin{cases}x^2 & x\geq0\\-x & x<0\end{cases}`],
    ['方程组',String.raw`\begin{cases}ax+by=c\\dx+ey=f\end{cases}`],['二次方程',String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`],
  ]],
  ['微积分', [
    ['导数',String.raw`\frac{\mathrm{d}y}{\mathrm{d}x}`],['偏导数',String.raw`\frac{\partial f}{\partial x}`],['积分',String.raw`\int_a^b f(x)\,\mathrm{d}x`],['二重积分',String.raw`\iint_D f(x,y)\,\mathrm{d}x\,\mathrm{d}y`],
    ['极限',String.raw`\lim_{x\to0}\frac{\sin x}{x}=1`],['求和',String.raw`\sum_{i=1}^{n}x_i`],['连乘',String.raw`\prod_{i=1}^{n}p_i`],['梯度',String.raw`\nabla f=\left(\frac{\partial f}{\partial x},\frac{\partial f}{\partial y}\right)`],
  ]],
  ['矩阵与向量', [
    ['矩阵',String.raw`A=\begin{bmatrix}a&b\\c&d\end{bmatrix}`],['列向量',String.raw`\boldsymbol{x}=\begin{bmatrix}x_1\\x_2\\x_3\end{bmatrix}`],['内积',String.raw`\boldsymbol{x}^{\mathsf T}\boldsymbol{y}=\sum_i x_i y_i`],['范数',String.raw`\|\boldsymbol{x}\|_2=\sqrt{\sum_i x_i^2}`],
    ['线性变换',String.raw`\boldsymbol{y}=A\boldsymbol{x}+\boldsymbol{b}`],['特征值',String.raw`A\boldsymbol{v}=\lambda\boldsymbol{v}`],['行列式',String.raw`\det A=ad-bc`],
  ]],
  ['概率与统计', [
    ['条件概率',String.raw`P(A\mid B)=\frac{P(A\cap B)}{P(B)}`],['贝叶斯公式',String.raw`P(A\mid B)=\frac{P(B\mid A)P(A)}{P(B)}`],['期望',String.raw`\mathbb{E}[X]=\sum_i x_i p_i`],['方差',String.raw`\operatorname{Var}(X)=\mathbb{E}[(X-\mu)^2]`],
    ['正态分布',String.raw`p(x)=\frac{1}{\sigma\sqrt{2\pi}}e^{-\frac{(x-\mu)^2}{2\sigma^2}}`],['样本均值',String.raw`\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i`],['协方差',String.raw`\operatorname{Cov}(X,Y)=\mathbb{E}[(X-\mu_X)(Y-\mu_Y)]`],
  ]],
  ['集合与逻辑', [
    ['集合',String.raw`S=\{x\in\mathbb{R}\mid x\geq0\}`],['交集与并集',String.raw`A\cap B\subseteq A\cup B`],['全称与存在',String.raw`\forall x\in X,\ \exists y\in Y:\ y=f(x)`],['蕴含',String.raw`A\land B\Rightarrow C`],['等价',String.raw`A\Leftrightarrow B`],['映射',String.raw`f:X\longrightarrow Y`],
  ]],
  ['工程关系', [
    ['传递耗时',String.raw`T=\sum_{i=1}^{n}t_i`],['耗时约束',String.raw`T\leq T_{\max}`],['吞吐率',String.raw`Q=\frac{N}{\Delta t}`],['状态变化',String.raw`\boldsymbol{x}_{t+1}=f(\boldsymbol{x}_t,\boldsymbol{u}_t)`],
    ['误差约束',String.raw`\|y-\hat{y}\|\leq\varepsilon`],['反馈控制',String.raw`u(t)=K_p e(t)+K_i\int_0^t e(\tau)\,\mathrm{d}\tau+K_d\frac{\mathrm{d}e}{\mathrm{d}t}`],['最优化',String.raw`x^*=\underset{x\in\mathcal{X}}{\operatorname{argmin}}\ L(x)`],['加权组合',String.raw`y=\sum_i w_i x_i,\quad\sum_i w_i=1`],
  ]],
]
export const MATH_SYMBOL_GROUPS = [
  ['运算','+ − × ÷ ± ∓ = ≠ ≈ ∝ ≤ ≥ < > ∞'],['希腊字母','α β γ δ ε θ λ μ π σ τ φ ω Δ Σ Ω'],
  ['集合逻辑','∈ ∉ ⊆ ⊂ ∪ ∩ ∅ ∀ ∃ ¬ ∧ ∨ ⇒ ⇔ → ↦'],['微积分','∑ ∏ ∫ ∬ ∂ ∇ ′ ″'],
]
/* MathML 输出不支持顶层换行：\ 在 MathML 里不会断行，两行会挤成一行（"G=… Gδ=…"）。
   这里把**顶层**的 \\[..] / \\ 换成 ,\quad 分隔，至少读得出来；矩阵/分段函数等
   环境内部的 \\ 是行分隔符，必须原样保留。 */
function separateTopLevelBreaks(tex) {
  const s = String(tex || '')
  let out = '', depth = 0, i = 0
  while (i < s.length) {
    if (s.startsWith('\\begin{', i)) { depth++; out += '\\begin{'; i += 7; continue }
    if (s.startsWith('\\end{', i)) { depth = Math.max(0, depth - 1); out += '\\end{'; i += 5; continue }
    if (depth === 0 && s.startsWith('\\\\', i)) {
      i += 2
      const bracket = /^\[[^\]]*\]/.exec(s.slice(i))
      if (bracket) i += bracket[0].length
      out += ',\\quad '
      continue
    }
    out += s[i++]
  }
  return out
}
export function formulaMarkup(source, renderer) {
  const value=separateTopLevelBreaks(source).trim(),escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  if(!value)return {html:'',error:null}
  if(value.length>10000)return {html:escape(value.slice(0,100))+'…',error:'公式太长，请分成多个部位。'}
  try{return {html:renderer.renderToString(value,{output:'mathml',displayMode:true,throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:20}),error:null}}
  catch{return {html:'<span class="math-invalid">'+escape(value)+'</span>',error:'公式暂时无法排版，请检查括号、上下标或分式是否完整。'}}
}
