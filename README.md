# Babel JSX Template Vars
A Babel transform for rendering a template friendly version of your JSX app.  Useful for generating a Handlebars based pre-render for achieving SSR in environments which don't support JavaScript rendering (e.g. PHP).

## What are template var
The idea is that this transform will replace selected variables (across the components you specify) with Handlebars tags such as `{{name}}`. 

This should be used in a pre-render build of your application, where you would save the html output to a file to be rendered later via your server.

Replacing variables with template tags allows you to render your application via the [Handlebars](https://handlebarsjs.com/) templating engine which has plenty of server side implemenations.

There are **a fair few limitations** so your mileage may vary.

## How it works

Add this transform plugin to babel in your pre-render build to replace your component variables with template tags such as `{{name}}`- allowing the resulting markup to be processed as a Handlebars compatible template.

### Workflow
1. Assumes you already have a React/Preact app with your development/production builds setup.
2. Create an additional build, a **pre-render** - which renders your app and extracts the rendered html (markup after running your app) into a file so it can be processed later on your server.
3. **Add this plugin to the pre-render build** to add the Handlebars tags to the html output.
4. Configure by adding `.templateVars` to components that have dynamic data.
5. Via your server side language (eg PHP), process the saved template file and pass in your data.

### An example

Lets take a component: 

```js
const HelloWorld = ({ name }) => (
  <div>
    <h1>Hello {name}</h1>
  </div>
);
```
Once we run our app, this might generate html like:
```html
<div>
  <h1>Hello John</h1>
</div>
```
In order to render this on the server using Handlebars, we need to replace the name `John` qwith a template tag, so the output would be

```html
<div>
    <h1>Hello {{name}}</h1>
</div>
```

Using this plugin, adding a `.templateVars` property on your component will render it using the Handlebars template tag above.

```js
const HelloWorld = ({ name }) => (
  <div>
    <h1>Hello { name }</h1>
  </div>
);
HelloWorld.templateVars = [ 'name' ];
```
There are other types variables (not only strings to be replaced) such as control and list variables.

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

Note: You will still need to add this transform to your existing builds (with the option `tidyOnly: true`) so that the `.templateVars` are removed from your production/development code:

```js
plugins: [
    [ 'babel-plugin-jsx-template-props', { tidyOnly: true } ]
],
```

### Define which props will be template props

Add a `templateVars` property to your components so we know which props need to be replaced with template tags, format is an array of strings:

```jsx
const Person = ( { name, favoriteColor } ) => {
    return (
        <>
            <h1>{ name }</h1>
            <p>Favorite color: { favoriteColor }</p>
        </>
    );
};
Person.templateVars = [ 'name', 'favoriteColor' ];
```
### Control variables (showing/hiding content)



### Lists (and repeatable elements)

To use repeatable elements and lists in Handlebars templates, our code must be contain special tags, before and after the list, with the single repeatable item in between.

```html
    <section class="profile">
        {{#favoriteColors}}
            <p>Favorite color: {{label}}</p>
        {{/favoriteColors}}
    </section>
```

First we need to define which prop is an array (`favoriteColors`) and then also which props we need to create template tags for.

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
// Setup favoriteColors as type array with objects as children.
Person.templateVars = [ 'name', [ 'favoriteColors', { type: 'array', child: { type: 'object', props: [ 'value', 'label' ] } } ] ];
```

This will generate an array with a single value (and Handlebars tags), with an object as described by the `child` props, resulting in the following output:

```html
    <section class="profile">
        <p>Favorite color: {{label}}</p>
    </section>
```
### Adding the opening + closing list tags (work in progress)

Right now there is no way to automatically insert these tags, so the current workaround is using JSX comments to signal where they should occur:
```jsx
    <section class="profile">
        { /* Template Props: list-start: favoriteColors */ }
        { favoriteColorsList }
        { /* Template Props: list-end: favoriteColors */ }
    </section>
```

Will be converted to:

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

#### The goal for a v1
...is to have the addition of the opening and closing list tags automated (so the comments won't be necessary)

We whould be able to track the prop (in the above example `favoriteColors`) from being passed into the component as a prop, all the way down to the components return (after `.map()`), and then automatically wrap it with the opening and closing list tags.  

[Keep up to date on the issue here](https://github.com/rmorse/babel-plugin-jsx-template-props/issues/1).


## Working example
[ ] _currently working on a new repo for a demo project..._

## Caveats

### This is an experiment
As it says, this is an exploration on a concept of semi automating the generation of Handlebars templates from JSX apps - its a first pass with a lot of holes and things to do as such its marked as alpha - 0.0.1-alpha - _feel free to help with the project / offer alternative ideas for exploration / report bugs_.

### Data fetching & loading
One thing to watch out for is data fetching and loading.

In complex applications, props will often get passed down into various data fetching routines, and if they are replaced with template tags such as `{{name}}` it might cause them to fail.  They need to succeed and continue as usual to get a true render.

To work around this you can try to set your template props only on components that live underneath the data requests (futher down the tree) that use those props for data fetching.

### Nested props
This transform supports nested props (arrays and objects), but only supports 1 level of depth.

It is recommended to set template props on components that reside further down the tree and deal with those nested props directly.

### Props with computations
Lets say you pass a prop with a number value, such as 10, replacing that should be fine if it is displayed "as is" or as part of a string.

```jsx
const Box = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>One Box is { size }</p>
            <p>Two Boxes are { doubleSize }</p>
        </>
    );
};
Box.templateVars = [ 'size' ];
```

However if you need to do a computation with it, and then display it, things get a bit more tricky.
```jsx
const Box = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>Size is { size }</p>
            <p>Double size is { doubleSize }</p>
        </>
    );
};
Box.templateVars = [ 'size' ];
```
Right now this is not supported.

The current workaround would be to set templateVars on the variable before and after the computation (you'll need seperate components), but this is not ideal.

```jsx
const BoxOne = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>Size is { size }</p>
            <BoxTwo size={ doubleSize } />
        </>
    );
};
BoxOne.templateVars = [ 'size' ];

const BoxTwo = ( { size } ) => {
    return (
        <p>Double size is { size }</p>
    );
};
BoxTwo.templateVars = [ 'size' ];
```

#### Potential solution
A possible solution could be to change this plugins behaviour from defining `templateVars`, and instead allow for any variable to be exposed inside the component.  `templateTags` could be used instead to reference any variable or nested prop.
```jsx
const Box = ( { size } ) => {
    const doubleSize = size * 2;
    return (
        <>
            <p>One Box is { size }</p>
            <p>Two Boxes are { doubleSize }</p>
        </>
    );
};

// This could reference any any variable inside the component and expose it to Handlebars
Box.templateTags = [ 'size', 'doubleSize', 'nested.prop' ];
```
