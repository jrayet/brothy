# Equations

A note to check that LaTeX fences are typeset and laid out as pictures.

## The quadratic formula

```latex
\frac{-b \pm \sqrt{b^2-4ac}}{2a}
```

## A sum

```math
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
```

## A derivation, taller than one formula

```tex
\begin{aligned}
I^2 &= \int_0^{2\pi}\!\int_0^\infty e^{-r^2} r\,dr\,d\theta \\
    &= 2\pi\left[-\tfrac12 e^{-r^2}\right]_0^\infty \\
    &= \pi
\end{aligned}
```

## A matrix

```latex
\begin{bmatrix}
a & b \\
c & d
\end{bmatrix}^{-1} = \frac{1}{ad-bc}\begin{bmatrix} d & -b \\ -c & a \end{bmatrix}
```

Inline maths such as $a^2 + b^2 = c^2$ stays as Markdown text for now.
