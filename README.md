# Babel JSX Template Props
A Babel transform for rendering a template friendly version of your JSX app.  Useful for generating a Mustache based pre-render for achieving SSR in environments which don't support JavaScript rendering (e.g. PHP).

## What are template props
The idea is that this transform will replace selected props (across the components you specify) with a placeholder string such as `{{name}}`. 

This allows you to render the component with a template engine (i.e. Mustache) and then replace the placeholders with the actual values. 

The pre-rendered version of your app should be saved to static template files for processing via the server.

Currently supports [Mustache](https://mustache.github.io/) templates as they can be processed and rendered in almost any server environment.

Useful for generating a pre-render for SSR in environments such as PHP * **with a fair few limitations**.

## How it works

Add this transform plugin to babel in your pre-render build to replace your component props to with template strings (tags) such as `{{name}}`- allowing your markup to be processed as a Mustache compatible template.

### Workflow
1. Assumes you already have a React / Preact app with your development / production builds setup.
2. Create an additional build, a **pre-render** - which renders your app, and extracts the rendered html (markup after running your app) into a file so it can be processed later on your server.
3. **Add this plugin to the pre-render build** to add the Mustache tags to the html output.
4. Configure by adding `.templateProps` to components that have dynamic data.
5. Via your server side language (eg PHP), process the saved template file and pass in your data.

Note: You will still need to add this transform to your other builds (with the option `tidyOnly: true`) so that it removes `templateProps` from your production/development code:

```
plugins: [
    [ 'babel-plugin-jsx-template-props', { tidyOnly: true } ]
],
```

## How to use

First install the package:

`npm install babel-plugin-jsx-template-props`

Then add it as it as a plugin to Babel.

### Via .babelrc
```js
{
  "plugins": [
    "babel-plugin-jsx-template-props"
  ]
}
```
### With babel-loader + webpack
```js
{
    test: /\.(js|jsx|tsx|ts)$/,
    exclude: /node_modules/,
    loader: "babel-loader",
    options: {
        plugins: [
            'babel-plugin-jsx-template-props'
        ],
        presets: []
    }
},
```

### Define which props will be template props

Add a `templateProps` property to your components so we know which props need to be replaced with template strings, format is an array of strings:

```jsx
const Person = ( { name, favoriteColor } ) => {
    return (
        <>
            <h1>{ name }</h1>
            <p>Favorite color: { favoriteColor }</p>
        </>
    );
};
Person.templateProps = [ 'name', 'favoriteColor' ];
```

### Lists and repeatable elements

Lists are repeatable, so we need to take into consideration a few things.

We can define that one of our template props will be array like, so we know it's repeatable and the shape (props) of the objects in the array.

```jsx
const Person = ( { name, favoriteColors } ) => {
    const favoriteColorsList = favoriteColors.map( ( color, index ) => {
        return (
            <p key={ index }>Favorite color: { color.label }</p>
        );
    } );
    return (
        <>
            <h1>{ name }</h1>
            { favoriteColorsList }
        </>
    );
};
Person.templateProps = [ 'name', [ 'favoriteColors', { type: 'array', child: { type: 'object', props: [ 'value', 'label' ] } } ] ];
```
This will generate an array with a single value (and Mustache tags), with an object as described by the `child` props:

```js
[
    {
        value: '{{value}}',
        label: '{{label}}',
    }
]
```
### Telling Mustache that the array is a list (work in progress)

It's important to signal to Mustache when a list or repeatable element starts and ends - so we can supply array like data when 
generating the render on the server.

While the plan is to automate this, for now we have a work a workaround using JSX comments, which get transformed to the correct Mustache syntax, e.g.:
```jsx
    <section class="profile">
        { /* Template Props: list-start: favoriteColors */ }
        { favoriteColorsList }
        { /* Template Props: list-end: favoriteColors */ }
    </section>
```

Which will be converted to:

```html
    <section class="profile">
        {{#favoriteColors}}
            <p>Favorite color: {{label}}</p>
        {{/favoriteColors}}
    </section>
```

The comments must be in the format:
1. Start with `Template Props: `
2. Signal opening or closing list with `list-start: ` or `list-end: `
3. The name of the variable/list (e.g. `favoriteColors`)

**The goal for a v1** is to have a more robust and automated solution (so we don't need the comments), whereby we can track the prop (in the above example `favoriteColors`) from being passed into the component, all the way down to the components return (after `.map()`), and then automatically wrap it with the opening and closing list tags.  [Keep up to date on the issue here](https://github.com/rmorse/babel-plugin-jsx-template-props/issues/1).

Check out a full example... [ ] _working on it_...

## Caveats

### This is an experiment
As it says, this is an exploration on a concept of semi automating the generation of Mustache templates from JSX apps - its a first pass with a lot of holes and things to do as such its marked as alpha - 0.0.1-alpha - _feel free to help with the project / offer alternative ideas for exploration / report bugs_.

### Data fetching & loading
One thing to watch out for is data fetching and loading.

In complex applications, props will often get passed down into various data fetching routines, and if they are replaced with template strings such as `{{name}}` it might cause them to fail.  They need to succeed and continue as usual to get a true render.

To work around this you can try to set your template props only on components that live underneath the data requests (futher down the tree) that use those props for data fetching.

### Nested props
This transform supports nested props (arrays and objects), but only supports 1 level of depth.

It is recommended to set template props on components that reside further down the tree and deal with those nested props directly.

### Props with computations
Lets say you pass a prop with a number value, such as 10, replacing that should be fine if it is displayed "as is".

```jsx
const Stick = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>One stick is { size }</p>
            <p>Two stick are { doubleSize }</p>
        </>
    );
};
Stick.templateProps = [ 'size' ];
```

However if you need to do a computation with it, and then display it, things get a bit more tricky.
```jsx
const Stick = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>Size is { size }</p>
            <p>Double size is { doubleSize }</p>
        </>
    );
};
Stick.templateProps = [ 'size' ];
```
Right now this is not supported.

The current way around would be to set templateProps on the variable before and after the computation (you'll need seperate components), but this is not ideal. Further research required.

```jsx
const StickOne = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>Size is { size }</p>
            <StickTwo size={ doubleSize } />
        </>
    );
};
StickOne.templateProps = [ 'size' ];

const StickTwo = ( { size } ) => {
    return (
        <p>Double size is { size }</p>
    );
};
StickTwo.templateProps = [ 'size' ];
```


Possible solution
```jsx
const Stick = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>One stick is { size }</p>
            <p>Two stick are { doubleSize }</p>
        </>
    );
};

Stick.templateTags = [ 'size', 'doubleSize', 'nested.prop' ];
// this basically tracks any variable inside the component and can expose it
```